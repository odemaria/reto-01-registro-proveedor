import type { ContextoHerramienta } from "./contexto"

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/

export function esFechaValida(texto: string): boolean {
  if (!PATRON_FECHA.test(texto)) return false
  const fecha = new Date(`${texto}T00:00:00Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(texto)
}

/** Fecha local del sistema en formato AAAA-MM-DD. */
export function hoyLocal(): string {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, "0")
  const dia = String(ahora.getDate()).padStart(2, "0")
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

/**
 * Fecha contra la que se evalúan las vigencias de los soportes.
 * Prioridad: ctx.fechaReferencia → variable FECHA_REFERENCIA → fecha del sistema.
 */
export function fechaReferencia(ctx: ContextoHerramienta): string {
  const candidatas = [ctx.fechaReferencia, process.env.FECHA_REFERENCIA]
  for (const candidata of candidatas) {
    if (candidata && esFechaValida(candidata.trim())) return candidata.trim()
  }
  return hoyLocal()
}

/** Días desde `desde` hasta `hasta` (negativo si `hasta` es anterior). */
export function diasEntre(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}
