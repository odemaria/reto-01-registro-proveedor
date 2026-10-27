/**
 * demo.ts — ejecuta las herramientas sobre todos los casos SIN modelo de lenguaje (PRD 6.6).
 *
 *   bun install && bun run demo.ts
 *
 * No necesita ninguna clave. Limpia out/ al inicio para que el resultado sea determinista.
 * Fecha de referencia para vigencias: FECHA_REFERENCIA o 2026-09-03 (fecha del PRD).
 */
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { listarCasos } from "./src/dominio/caso"
import type { ContextoHerramienta } from "./src/dominio/contexto"
import { esFechaValida } from "./src/dominio/fechas"
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from "./src/tools/proveedor"

const FECHA_DEMO = "2026-09-03"
const raiz = fileURLToPath(new URL(".", import.meta.url))
const fecha = process.env.FECHA_REFERENCIA && esFechaValida(process.env.FECHA_REFERENCIA) ? process.env.FECHA_REFERENCIA : FECHA_DEMO
const ctx: ContextoHerramienta = { directory: raiz, sessionId: "demo", fechaReferencia: fecha }

type Respuesta = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

function leer(json: string): Respuesta {
  return JSON.parse(json) as Respuesta
}

function lista(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.map((v) => (typeof v === "string" ? v : String((v as { etiqueta?: string }).etiqueta ?? v))) : []
}

async function procesar(caso: string): Promise<void> {
  console.log(`\n━━━ ${caso} ━━━`)

  const solicitud = leer(await leer_solicitud.execute({ caso }, ctx))
  if (!solicitud.ok) {
    console.log(`  ✗ leer_solicitud: ${solicitud.error}`)
    return
  }
  const s = solicitud.data
  const campos = lista(s.campos)
  console.log(`  País ${s.pais} · Cliente: ${s.cliente} · Formato: ${s.formato} · ${campos.length} campos`)
  for (const advertencia of lista(s.advertencias)) console.log(`  ! ${advertencia}`)

  const mapeo = leer(await mapear_campos.execute({ caso, campos }, ctx))
  if (mapeo.ok) {
    const m = mapeo.data
    console.log(`  Mapeo: ${lista(m.llenos).length} llenos · ${lista(m.requiere_confirmacion).length} por confirmar · ${lista(m.faltantes).length} faltantes`)
    if (lista(m.requiere_confirmacion).length) console.log(`    Por confirmar: ${lista(m.requiere_confirmacion).join(", ")}`)
    if (lista(m.faltantes).length) console.log(`    Faltantes: ${lista(m.faltantes).join(", ")}`)
  } else console.log(`  ✗ mapear_campos: ${mapeo.error}`)

  const formulario = leer(await generar_formulario.execute({ caso }, ctx))
  if (formulario.ok) {
    const aviso = typeof formulario.data.aviso === "string" ? ` — ${formulario.data.aviso.split(":")[0]}` : ""
    console.log(`  Formulario: ${formulario.data.ruta}${aviso}`)
  } else console.log(`  ✗ generar_formulario: ${formulario.error}`)

  const paquete = leer(await armar_paquete.execute({ caso }, ctx))
  if (paquete.ok) {
    const checklist = paquete.data.checklist as { bloqueantes: string[] }
    console.log(`  Paquete: ${paquete.data.ruta} · listo_para_firma=${paquete.data.listo_para_firma}`)
    for (const b of checklist.bloqueantes) console.log(`    ⛔ ${b}`)
  } else console.log(`  ✗ armar_paquete: ${paquete.error}`)

  const sinConfirmar = leer(await simular_envio.execute({ caso, confirmado: false }, ctx))
  console.log(`  Envío sin confirmación: ${sinConfirmar.ok ? "¡se ejecutó! (error)" : `bloqueado → "${sinConfirmar.error}"`}`)
}

async function main(): Promise<void> {
  await rm(join(raiz, "out"), { recursive: true, force: true })
  console.log(`Demo de herramientas sin modelo · fecha de referencia ${fecha}`)

  const casos = await listarCasos(ctx)
  for (const caso of casos) await procesar(caso)

  console.log("\n━━━ Manejo de errores (HU-5) ━━━")
  const inexistente = leer(await leer_solicitud.execute({ caso: "caso-que-no-existe" }, ctx))
  console.log(`  Caso inexistente: ${inexistente.ok ? "?" : inexistente.error}`)
  const invalido = leer(await leer_solicitud.execute({ caso: "../secretos" }, ctx))
  console.log(`  Ruta maliciosa: ${invalido.ok ? "?" : invalido.error}`)

  console.log("\nSalidas en out/<caso>/ · bitácora en out/log.jsonl\n")
}

await main()
