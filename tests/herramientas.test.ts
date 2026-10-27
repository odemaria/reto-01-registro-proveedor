import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import ExcelJS from "exceljs"
import type { ContextoHerramienta } from "../src/dominio/contexto"
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from "../src/tools/proveedor"
import { cargarHerramientas } from "../src/tools/registro"
import { datos, parsear, proyectoTemporal } from "./utilidades"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>

beforeAll(async () => {
  const p = await proyectoTemporal()
  ctx = p.ctx
  limpiar = p.limpiar
})
afterAll(() => limpiar())

describe("contrato de herramientas (6.2)", () => {
  test("se publican como <archivo>_<export> con esquema JSON", () => {
    const h = cargarHerramientas()
    expect([...h.keys()].sort()).toEqual([
      "proveedor_armar_paquete",
      "proveedor_generar_formulario",
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_simular_envio",
    ])
    const leer = h.get("proveedor_leer_solicitud")
    expect(leer?.esquema).toMatchObject({ type: "object", required: ["caso"] })
  })

  test("argumentos inválidos vuelven como error, sin lanzar", async () => {
    const h = cargarHerramientas().get("proveedor_mapear_campos")
    const r = parsear((await h?.ejecutar({ caso: 5 }, ctx)) ?? "")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("Argumentos inválidos")
  })
})

describe("caso co-industrias-delta (xlsx)", () => {
  test("HU-1: lee país, formato, campos y soportes", async () => {
    const d = datos(await leer_solicitud.execute({ caso: "co-industrias-delta" }, ctx))
    expect(d).toMatchObject({ pais: "CO", formato: "xlsx", soportes: ["camara_comercio", "rut", "certificacion_bancaria", "estados_financieros"] })
    expect(d.campos).toHaveLength(17)
  })

  test("HU-3: escribe cada valor en la hoja y celda exactas", async () => {
    datos(await generar_formulario.execute({ caso: "co-industrias-delta" }, ctx))
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(join(ctx.directory, "out", "co-industrias-delta", "formulario.xlsx"))
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("B4").value).toBe("NIT")
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("C4").value).toBe("900123456")
    expect(libro.getWorksheet("Datos Bancarios")?.getCell("C5").value).toBe("03100012345")
  })

  test("HU-4: paquete listo para firma, con soportes y sin datos bancarios en el correo", async () => {
    const d = datos(await armar_paquete.execute({ caso: "co-industrias-delta" }, ctx))
    expect(d.listo_para_firma).toBe(true)
    const correo = await readFile(join(ctx.directory, "out", "co-industrias-delta", "paquete", "borrador-correo.md"), "utf8")
    expect(correo).not.toContain("03100012345")
    expect(correo).not.toContain("COLOCOBM")
  })
})

describe("caso ec-corp-andina (pdf)", () => {
  test("RUC por confirmar, contribuyente especial faltante, PDF generado", async () => {
    const m = datos(await mapear_campos.execute({ caso: "ec-corp-andina", campos: [] }, ctx))
    expect((m.faltantes as Array<{ etiqueta: string }>).map((f) => f.etiqueta)).toEqual(["Número de contribuyente especial"])
    const f = datos(await generar_formulario.execute({ caso: "ec-corp-andina" }, ctx))
    expect(f.ruta).toBe("out/ec-corp-andina/formulario.pdf")
    const pdf = await readFile(join(ctx.directory, "out", "ec-corp-andina", "formulario.pdf"))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  })

  test("soporte exigido ausente bloquea listo_para_firma", async () => {
    const d = datos(await armar_paquete.execute({ caso: "ec-corp-andina" }, ctx))
    expect(d.listo_para_firma).toBe(false)
    expect(JSON.stringify(d.checklist)).toContain("certificado_cumplimiento_tributario")
  })
})

describe("caso hn-agroexport-sula (vencidos)", () => {
  test("parafiscales vencido bloquea y no se copia al paquete", async () => {
    datos(await generar_formulario.execute({ caso: "hn-agroexport-sula" }, ctx))
    const d = datos(await armar_paquete.execute({ caso: "hn-agroexport-sula" }, ctx))
    expect(d.listo_para_firma).toBe(false)
    expect(d.archivos).not.toContain("soportes/parafiscales-2026-07.txt")
  })

  test("con otra fecha de referencia el resultado cambia (vigencias dinámicas)", async () => {
    const antes = { ...ctx, fechaReferencia: "2026-08-30" }
    const d = datos(await armar_paquete.execute({ caso: "hn-agroexport-sula" }, antes))
    expect(d.listo_para_firma).toBe(true)
  })
})

describe("caso pa-logistica-istmo (portal)", () => {
  test("formato no soportado: genera valores-portal.md", async () => {
    const d = datos(await generar_formulario.execute({ caso: "pa-logistica-istmo" }, ctx))
    expect(d.soportado).toBe(false)
    expect(String(d.aviso)).toStartWith("formato no soportado")
    const md = await readFile(join(ctx.directory, "out", "pa-logistica-istmo", "valores-portal.md"), "utf8")
    expect(md).toContain("| RUC * | 900123456 | por confirmar |")
  })
})

describe("confirmación y errores (HU-4, HU-5)", () => {
  test("simular_envio sin confirmación devuelve el error exacto", async () => {
    const r = parsear(await simular_envio.execute({ caso: "co-industrias-delta", confirmado: false }, ctx))
    expect(r).toEqual({ ok: false, error: "requiere confirmación explícita" })
  })

  test("simular_envio confirmado escribe ENVIO-SIMULADO.md", async () => {
    datos(await generar_formulario.execute({ caso: "co-industrias-delta" }, ctx))
    datos(await armar_paquete.execute({ caso: "co-industrias-delta" }, ctx))
    const d = datos(await simular_envio.execute({ caso: "co-industrias-delta", confirmado: true }, ctx))
    expect(d.ruta).toBe("out/co-industrias-delta/ENVIO-SIMULADO.md")
  })

  test("caso inexistente: mensaje claro con los casos disponibles", async () => {
    const r = parsear(await leer_solicitud.execute({ caso: "no-existe" }, ctx))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("Casos disponibles: co-industrias-delta")
  })

  test("plantilla corrupta: no lanza, avisa y el paquete se arma igual", async () => {
    await writeFile(join(ctx.directory, "fixtures", "reto-01", "casos", "hn-agroexport-sula", "plantilla-celdas.json"), "{ esto no es json")
    const leido = datos(await leer_solicitud.execute({ caso: "hn-agroexport-sula" }, ctx))
    expect(String(leido.advertencias)).toContain("corrupto")
    const gen = parsear(await generar_formulario.execute({ caso: "hn-agroexport-sula" }, ctx))
    expect(gen.ok).toBe(false)
    if (!gen.ok) expect(gen.error).not.toMatch(/at .*\.ts/)
    const paquete = datos(await armar_paquete.execute({ caso: "hn-agroexport-sula" }, ctx))
    expect(paquete.ruta).toBe("out/hn-agroexport-sula/paquete")
  })

  test("toda llamada queda en out/log.jsonl", async () => {
    const log = await readFile(join(ctx.directory, "out", "log.jsonl"), "utf8")
    const primera = JSON.parse(log.split("\n")[0] ?? "{}") as Record<string, unknown>
    expect(Object.keys(primera)).toEqual(expect.arrayContaining(["ts", "herramienta", "ok", "resumen"]))
  })
})
