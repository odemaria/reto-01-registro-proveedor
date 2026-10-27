import { z } from "zod"
import { registrar } from "../dominio/bitacora"
import { mensajeDeError } from "../dominio/resultado"
import * as proveedor from "./proveedor"
import type { ContextoHerramienta, Forma, Herramienta } from "./tipos"

/** Archivos de herramientas: cada export se publica como `<archivo>_<export>`. */
const MODULOS: Record<string, Record<string, unknown>> = { proveedor }

/** Herramientas con efecto "externo": el ciclo exige confirmación humana antes de ejecutarlas (RN4). */
export const REQUIEREN_CONFIRMACION = new Set(["proveedor_simular_envio"])

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  esquema: Record<string, unknown>
}

export type HerramientaRegistrada = DefinicionHerramienta & {
  ejecutar(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

function esHerramienta(valor: unknown): valor is Herramienta<Forma> {
  if (typeof valor !== "object" || valor === null) return false
  const v = valor as Record<string, unknown>
  return typeof v.description === "string" && typeof v.args === "object" && typeof v.execute === "function"
}

function registrarHerramienta(nombre: string, herramienta: Herramienta<Forma>): HerramientaRegistrada {
  const esquema = z.object(herramienta.args).strict()
  const jsonSchema = z.toJSONSchema(esquema, { target: "draft-7", io: "input" }) as Record<string, unknown>
  delete jsonSchema.$schema
  return {
    nombre,
    descripcion: herramienta.description,
    esquema: jsonSchema,
    async ejecutar(args, ctx) {
      // El backend valida antes de ejecutar y devuelve el error al modelo si no cumple (6.2).
      const validado = esquema.safeParse(args ?? {})
      if (!validado.success) {
        const detalle = validado.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ")
        const error = `Argumentos inválidos para ${nombre}: ${detalle}`
        await registrar(ctx, { herramienta: nombre, ok: false, resumen: error })
        return JSON.stringify({ ok: false, error })
      }
      try {
        return await herramienta.execute(validado.data, ctx)
      } catch (error) {
        return JSON.stringify({ ok: false, error: `Error inesperado en ${nombre}: ${mensajeDeError(error)}` })
      }
    },
  }
}

export function cargarHerramientas(): Map<string, HerramientaRegistrada> {
  const mapa = new Map<string, HerramientaRegistrada>()
  for (const [archivo, exports] of Object.entries(MODULOS)) {
    for (const [nombreExport, valor] of Object.entries(exports)) {
      if (!esHerramienta(valor)) continue
      const nombre = `${archivo}_${nombreExport}`
      mapa.set(nombre, registrarHerramienta(nombre, valor))
    }
  }
  return mapa
}
