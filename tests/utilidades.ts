import { cpSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ContextoHerramienta } from "../src/dominio/contexto"

export const RAIZ = fileURLToPath(new URL("..", import.meta.url))
export const FECHA_PRUEBAS = "2026-09-03"

/** Copia los fixtures a una carpeta temporal: las pruebas pueden dañarlos sin tocar los originales. */
export async function proyectoTemporal(): Promise<{ ctx: ContextoHerramienta; limpiar: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "reto01-"))
  cpSync(join(RAIZ, "fixtures"), join(dir, "fixtures"), { recursive: true })
  return {
    ctx: { directory: dir, sessionId: "pruebas", fechaReferencia: FECHA_PRUEBAS },
    limpiar: () => rm(dir, { recursive: true, force: true }),
  }
}

export type Respuesta = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

export function parsear(json: string): Respuesta {
  return JSON.parse(json) as Respuesta
}

export function datos(json: string): Record<string, unknown> {
  const r = parsear(json)
  if (!r.ok) throw new Error(`Se esperaba ok:true y llegó: ${r.error}`)
  return r.data
}
