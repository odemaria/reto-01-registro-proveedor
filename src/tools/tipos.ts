import type { z } from "zod"
// Nota: ArgsDe usa z.ZodObject para que los campos .optional() sean opcionales en el tipo.
import type { ContextoHerramienta } from "../dominio/contexto"
import { registrar } from "../dominio/bitacora"
import { mensajeDeError, type Resultado } from "../dominio/resultado"

export type { ContextoHerramienta }

export type Forma = Record<string, z.ZodType>
export type ArgsDe<F extends Forma> = z.infer<z.ZodObject<F>>

/** Contrato de la sección 6.2: description + args (zod) + execute que devuelve JSON y nunca lanza. */
export type Herramienta<F extends Forma> = {
  description: string
  args: F
  execute(args: ArgsDe<F>, ctx: ContextoHerramienta): Promise<string>
}

export function definirHerramienta<F extends Forma>(herramienta: Herramienta<F>): Herramienta<F> {
  return herramienta
}

/**
 * Ejecuta una operación, atrapa cualquier excepción, registra en la bitácora (RN5)
 * y devuelve siempre `{ ok, data }` o `{ ok: false, error }` serializado.
 */
export async function ejecutarSeguro<T>(
  nombre: string,
  ctx: ContextoHerramienta,
  caso: string | undefined,
  operacion: () => Promise<Resultado<T>>,
  resumir: (data: T) => string,
): Promise<string> {
  let resultado: Resultado<T>
  try {
    resultado = await operacion()
  } catch (error) {
    resultado = { ok: false, error: `Error inesperado en ${nombre}: ${mensajeDeError(error)}` }
  }
  const resumen = resultado.ok ? resumir(resultado.data) : resultado.error
  await registrar(ctx, { herramienta: nombre, ok: resultado.ok, resumen, caso: resultado.ok ? caso : undefined })
  return JSON.stringify(resultado)
}
