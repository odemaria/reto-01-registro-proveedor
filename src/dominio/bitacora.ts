import { appendFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "./contexto"
import { rutasDe, validarNombreCaso } from "./rutas"

export type EntradaBitacora = {
  herramienta: string
  ok: boolean
  resumen: string
  caso?: string
}

/**
 * RN5 / CA4: cada llamada deja { ts, herramienta, ok, resumen } en out/log.jsonl y en
 * out/<caso>/log.jsonl. Solo se registran resúmenes: nunca valores sensibles ni claves.
 * Un fallo al escribir la bitácora no interrumpe la herramienta.
 */
export async function registrar(ctx: ContextoHerramienta, entrada: EntradaBitacora): Promise<void> {
  const linea = `${JSON.stringify({ ts: new Date().toISOString(), sesion: ctx.sessionId, herramienta: entrada.herramienta, ok: entrada.ok, resumen: entrada.resumen })}\n`
  const out = rutasDe(ctx).out
  const destinos = [join(out, "log.jsonl")]
  if (entrada.caso && validarNombreCaso(entrada.caso).ok) destinos.push(join(out, entrada.caso, "log.jsonl"))
  for (const destino of destinos) {
    try {
      await mkdir(join(destino, ".."), { recursive: true })
      await appendFile(destino, linea, "utf8")
    } catch {
      // La bitácora es de apoyo: si el disco falla, la herramienta igual responde.
    }
  }
}
