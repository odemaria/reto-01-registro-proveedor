import type { ContextoHerramienta } from "./contexto"
import { leerJson } from "./archivos"
import { esquemaGlosario, esquemaMaestro, type Glosario, type Maestro } from "./esquemas"
import { exito, type Resultado } from "./resultado"
import { rutasDe } from "./rutas"

export type ValorMaestro = string | number | boolean

export async function leerMaestro(ctx: ContextoHerramienta): Promise<Resultado<Maestro>> {
  return leerJson(rutasDe(ctx).maestro, esquemaMaestro, "El repositorio maestro (maestro.json)")
}

export async function leerGlosario(ctx: ContextoHerramienta): Promise<Resultado<Glosario>> {
  return leerJson(rutasDe(ctx).glosario, esquemaGlosario, "El glosario de campos")
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

/** Lee "banco.numero_cuenta" del maestro. Devuelve undefined si no existe o está vacío. */
export function resolverClave(maestro: Maestro, clave: string): ValorMaestro | undefined {
  let actual: unknown = maestro
  for (const parte of clave.split(".")) {
    if (!esObjeto(actual)) return undefined
    actual = actual[parte]
  }
  if (typeof actual === "string") return actual.trim() === "" ? undefined : actual
  if (typeof actual === "number" || typeof actual === "boolean") return actual
  if (Array.isArray(actual) && actual.length > 0 && actual.every((x) => typeof x === "string")) {
    return actual.join(", ")
  }
  return undefined
}

/** Todas las claves hoja del maestro en notación con puntos ("banco.swift", "nit", …). */
export function clavesHoja(maestro: Maestro, prefijo = ""): string[] {
  const claves: string[] = []
  for (const [clave, valor] of Object.entries(maestro)) {
    const completa = prefijo ? `${prefijo}.${clave}` : clave
    if (esObjeto(valor)) claves.push(...clavesHoja(valor, completa))
    else claves.push(completa)
  }
  return claves
}

/** Notas que dan contexto a un valor sin inventarlo (ej. moneda y año de los ingresos). */
export function notaDeClave(maestro: Maestro, clave: string): string | undefined {
  if (!clave.endsWith(".valor")) return undefined
  const padre = clave.slice(0, -".valor".length)
  const moneda = resolverClave(maestro, `${padre}.moneda`)
  const ano = resolverClave(maestro, `${padre}.ano`)
  const partes = [moneda ? `Moneda: ${moneda}` : "", ano ? `Año: ${ano}` : ""].filter(Boolean)
  return partes.length > 0 ? partes.join(" · ") : undefined
}

export function rutaEnMaestro(clave: string): string {
  return `repositorio/maestro.json#${clave}`
}

export async function cargarFuentes(ctx: ContextoHerramienta): Promise<Resultado<{ maestro: Maestro; glosario: Glosario }>> {
  const maestro = await leerMaestro(ctx)
  if (!maestro.ok) return maestro
  const glosario = await leerGlosario(ctx)
  if (!glosario.ok) return glosario
  return exito({ maestro: maestro.data, glosario: glosario.data })
}
