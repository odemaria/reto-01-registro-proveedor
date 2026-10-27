/**
 * Matriz de pruebas de las "trampas" del PRD (confirmación real, celdas exactas, faltante vs. soporte,
 * identificador extranjero, datos bancarios, timeout, determinismo). Cada describe nombra la trampa.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { inflateSync } from "node:zlib"
import ExcelJS from "exceljs"
import { ejecutarTurno, type DependenciasCiclo } from "../src/agent/ciclo"
import { AlmacenSesiones, type Sesion } from "../src/agent/sesiones"
import type { ContextoHerramienta } from "../src/dominio/contexto"
import type { Mensaje, ProveedorLLM, RespuestaLLM } from "../src/llm/adapter"
import { armar_paquete, generar_formulario, leer_solicitud, mapear_campos } from "../src/tools/proveedor"
import { cargarHerramientas } from "../src/tools/registro"
import { datos, parsear, proyectoTemporal, RAIZ } from "./utilidades"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>
beforeAll(async () => {
  const p = await proyectoTemporal()
  ctx = p.ctx
  limpiar = p.limpiar
})
afterAll(() => limpiar())

const CUENTA = "03100012345"
const SWIFT = "COLOCOBM"
const CEDULA = "71555123"

async function procesar(caso: string, c: ContextoHerramienta = ctx): Promise<Record<string, unknown>> {
  datos(await mapear_campos.execute({ caso, campos: [] }, c))
  datos(await generar_formulario.execute({ caso }, c))
  return datos(await armar_paquete.execute({ caso }, c))
}

function textoArchivo(caso: string, ...ruta: string[]): Promise<string> {
  return readFile(join(ctx.directory, "out", caso, ...ruta), "utf8")
}

async function celdasExcel(caso: string): Promise<Map<string, unknown>> {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.readFile(join(ctx.directory, "out", caso, "formulario.xlsx"))
  const celdas = new Map<string, unknown>()
  libro.eachSheet((hoja) => hoja.eachRow((fila) => fila.eachCell((celda) => celdas.set(`${hoja.name}!${celda.address}`, celda.value))))
  return celdas
}

/** Extrae el texto dibujado en el PDF (pdf-lib escribe cadenas hex <...> Tj en streams comprimidos). */
async function textoPdf(caso: string): Promise<string[]> {
  const bytes = await readFile(join(ctx.directory, "out", caso, "formulario.pdf"))
  const crudo = bytes.toString("latin1")
  const textos: string[] = []
  for (const m of crudo.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let contenido: string
    try {
      contenido = inflateSync(Buffer.from(m[1] ?? "", "latin1")).toString("latin1")
    } catch {
      continue
    }
    for (const h of contenido.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) textos.push(Buffer.from(h[1] ?? "", "hex").toString("latin1"))
  }
  return textos
}

// ───────────────────────── 2.1 No inventar ─────────────────────────

describe("2.1 la IA no inventa datos", () => {
  test("un campo inexistente queda faltante y el formulario lo deja vacío", async () => {
    await procesar("hn-agroexport-sula")
    const celdas = await celdasExcel("hn-agroexport-sula")
    expect(celdas.get("Registro!A12")).toBe("Referencias comerciales")
    expect(celdas.has("Registro!B12")).toBe(false)
  })

  test("los valores sensibles le llegan al modelo enmascarados; el formulario lleva el dato real", async () => {
    const m = datos(await mapear_campos.execute({ caso: "co-industrias-delta", campos: [] }, ctx))
    const salida = JSON.stringify(m)
    expect(salida).not.toContain(CUENTA)
    expect(salida).not.toContain(CEDULA)
    expect(await textoArchivo("co-industrias-delta", "mapeo.json")).not.toContain(CUENTA)
    datos(await generar_formulario.execute({ caso: "co-industrias-delta" }, ctx))
    const celdas = await celdasExcel("co-industrias-delta")
    expect(celdas.get("Datos Bancarios!C5")).toBe(CUENTA)
    expect(celdas.get("Datos Proveedor!C12")).toBe(CEDULA)
  })
})

// ───────────────────────── 2.2 Confirmación real ─────────────────────────

/** Modelo de prueba guionizado: devuelve, en orden, las respuestas indicadas. */
class Guion implements ProveedorLLM {
  readonly nombre = "guion"
  readonly modelo = "prueba"
  constructor(private readonly pasos: Array<(m: Mensaje[]) => RespuestaLLM>) {}
  async enviar(mensajes: Mensaje[]): Promise<RespuestaLLM> {
    const paso = this.pasos.shift()
    if (!paso) return { texto: "fin", llamadas: [], fin: "fin_turno", uso: { entrada: 0, salida: 0 } }
    return paso(mensajes)
  }
}
const texto = (t: string) => (): RespuestaLLM => ({ texto: t, llamadas: [], fin: "fin_turno", uso: { entrada: 0, salida: 0 } })
const llamar = (nombre: string, argumentos: Record<string, unknown>) => (): RespuestaLLM => ({
  texto: "",
  llamadas: [{ id: crypto.randomUUID(), nombre, argumentos }],
  fin: "herramientas",
  uso: { entrada: 0, salida: 0 },
})
const enviar = (caso: string) => llamar("proveedor_simular_envio", { caso, confirmado: true })

function deps(proveedor: ProveedorLLM, extra: Partial<DependenciasCiclo> = {}): DependenciasCiclo {
  return { proveedor, herramientas: cargarHerramientas(), sistema: "prueba", directorio: ctx.directory, fechaReferencia: ctx.fechaReferencia, maxIteraciones: 10, maxTokensSesion: 1_000_000, timeoutMs: 2_000, ...extra }
}

async function sesionConPreguntaDeEnvio(caso: string): Promise<{ sesion: Sesion; guion: Guion }> {
  await procesar(caso)
  const guion = new Guion([llamar("proveedor_armar_paquete", { caso }), texto(`Resumen.\n\n**Confirmación requerida:** ¿Confirmas que simule el envío del paquete de ${caso}?`)])
  const sesion = new AlmacenSesiones(10).obtenerOCrear()
  const t = await ejecutarTurno(sesion, `procesa ${caso}`, deps(guion))
  expect(t.pendingAction).toEqual({ herramienta: "proveedor_simular_envio", caso })
  return { sesion, guion }
}

const envioExiste = (caso: string) => existsSync(join(ctx.directory, "out", caso, "ENVIO-SIMULADO.md"))

describe("2.2 la confirmación humana es real (backend)", () => {
  test("'envía' sin pregunta previa: se rechaza y no se crea el envío", async () => {
    await procesar("pa-logistica-istmo")
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const t = await ejecutarTurno(sesion, "envía el paquete de pa-logistica-istmo", deps(new Guion([enviar("pa-logistica-istmo"), texto("ok")])))
    expect(t.toolCalls[0]?.bloqueadaPorPolitica).toBe(true)
    expect(t.toolCalls[0]?.resultado).toContain("requiere confirmación explícita")
    expect(envioExiste("pa-logistica-istmo")).toBe(false)
  })

  test("'sí' en una sesión sin acción pendiente: se rechaza", async () => {
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const t = await ejecutarTurno(sesion, "sí", deps(new Guion([enviar("pa-logistica-istmo"), texto("ok")])))
    expect(t.toolCalls[0]?.resumen).toContain("no había ninguna acción pendiente")
    expect(envioExiste("pa-logistica-istmo")).toBe(false)
  })

  test("cambio de caso después de la pregunta: se rechaza", async () => {
    const { sesion } = await sesionConPreguntaDeEnvio("co-industrias-delta")
    const t = await ejecutarTurno(sesion, "sí, envía el de pa-logistica-istmo", deps(new Guion([enviar("pa-logistica-istmo"), texto("ok")])))
    expect(t.toolCalls[0]?.bloqueadaPorPolitica).toBe(true)
    expect(t.toolCalls[0]?.resumen).toContain("otro caso")
    expect(envioExiste("pa-logistica-istmo")).toBe(false)
  })

  test("el modelo intenta enviar otro caso con la confirmación de este: se rechaza", async () => {
    const { sesion } = await sesionConPreguntaDeEnvio("co-industrias-delta")
    const t = await ejecutarTurno(sesion, "sí", deps(new Guion([enviar("pa-logistica-istmo"), texto("ok")])))
    expect(t.toolCalls[0]?.resumen).toContain("la confirmación fue para el caso co-industrias-delta")
    expect(envioExiste("pa-logistica-istmo")).toBe(false)
  })

  test("confirmación de una acción distinta (la pregunta no era de envío): se rechaza", async () => {
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const t1 = await ejecutarTurno(sesion, "hola", deps(new Guion([texto("**Confirmación requerida:** ¿Confirmas que procese el caso pa-logistica-istmo?")])))
    expect(t1.needsConfirmation).toBe(true)
    expect(t1.pendingAction).toEqual({ herramienta: null, caso: null })
    const t2 = await ejecutarTurno(sesion, "sí", deps(new Guion([enviar("pa-logistica-istmo"), texto("ok")])))
    expect(t2.toolCalls[0]?.resumen).toContain("no pedía confirmar un envío")
    expect(envioExiste("pa-logistica-istmo")).toBe(false)
  })

  test("una confirmación sirve una sola vez y solo en el turno siguiente", async () => {
    const { sesion } = await sesionConPreguntaDeEnvio("co-industrias-delta")
    const t = await ejecutarTurno(sesion, "sí, confirmo", deps(new Guion([enviar("co-industrias-delta"), enviar("co-industrias-delta"), texto("listo")])))
    expect(t.toolCalls.map((c) => c.ok)).toEqual([true, false])
    expect(t.toolCalls[1]?.resumen).toContain("ya se usó")
    expect(envioExiste("co-industrias-delta")).toBe(true)
    const t3 = await ejecutarTurno(sesion, "sí", deps(new Guion([enviar("co-industrias-delta"), texto("ok")])))
    expect(t3.toolCalls[0]?.ok).toBe(false)
  })
})

// ───────────────────────── 2.3 Excel en celdas exactas ─────────────────────────

describe("2.3 Excel: cada entrada de la plantilla en su hoja y celda", () => {
  test.each(["co-industrias-delta", "hn-agroexport-sula"])("%s", async (caso) => {
    await procesar(caso)
    const plantilla = JSON.parse(await readFile(join(RAIZ, "fixtures", "reto-01", "casos", caso, "plantilla-celdas.json"), "utf8")) as Array<{ hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }>
    const m = datos(await mapear_campos.execute({ caso, campos: [] }, ctx))
    const faltantes = new Set((m.faltantes as Array<{ etiqueta: string }>).map((f) => f.etiqueta))
    const celdas = await celdasExcel(caso)
    for (const p of plantilla) {
      expect(celdas.get(`${p.hoja}!${p.celda_etiqueta}`)).toBe(p.etiqueta)
      expect(celdas.has(`${p.hoja}!${p.celda_valor}`)).toBe(!faltantes.has(p.etiqueta))
    }
  })
})

// ───────────────────────── 2.4 Soporte vs. campo faltante ─────────────────────────

describe("2.4 soportes y campos faltantes se distinguen", () => {
  test("soporte ausente bloquea (ec-corp-andina)", async () => {
    const d = await procesar("ec-corp-andina")
    const c = d.checklist as Record<string, unknown>
    expect(d.listo_para_firma).toBe(false)
    expect(c.soportes_ausentes).toEqual(["certificado_cumplimiento_tributario"])
    expect(c.soportes_vencidos).toEqual([])
  })

  test("soporte vencido bloquea (hn-agroexport-sula)", async () => {
    const d = await procesar("hn-agroexport-sula")
    const c = d.checklist as Record<string, unknown>
    expect(d.listo_para_firma).toBe(false)
    expect(c.soportes_vencidos).toEqual(["parafiscales"])
    expect(c.soportes_ausentes).toEqual([])
    expect(await textoArchivo("hn-agroexport-sula", "paquete", "checklist.md")).toContain("| VENCIDO |")
  })

  test("campo faltante sin soportes problemáticos: aparece en el checklist y NO bloquea", async () => {
    const antes = { ...ctx, fechaReferencia: "2026-08-30" }
    const d = await procesar("hn-agroexport-sula", antes)
    const c = d.checklist as Record<string, unknown>
    expect(d.listo_para_firma).toBe(true)
    expect(c.faltantes).toEqual(["Referencias comerciales"])
    expect(c.formulario_completo).toBe(false)
    const checklist = await textoArchivo("hn-agroexport-sula", "paquete", "checklist.md")
    expect(checklist).toContain("Listo para firma: **sí**")
    expect(checklist).toContain("Formulario completo: **no**")
    expect(checklist).toContain("Referencias comerciales")
  })
})

// ───────────────────────── 2.5 Identificador extranjero ─────────────────────────

describe("2.5 identificador tributario extranjero", () => {
  test.each([
    ["ec-corp-andina", "RUC"],
    ["hn-agroexport-sula", "RTN"],
    ["pa-logistica-istmo", "RUC"],
  ])("%s: %s por confirmar con nota 'identificador extranjero'", async (caso, etiqueta) => {
    const m = datos(await mapear_campos.execute({ caso, campos: [] }, ctx))
    const campo = (m.requiere_confirmacion as Array<Record<string, unknown>>).find((c) => c.etiqueta === etiqueta)
    expect(campo?.nota).toBe("identificador extranjero")
    expect((m.llenos as Array<{ etiqueta: string }>).some((c) => c.etiqueta === etiqueta)).toBe(false)
  })

  test("el PDF de Ecuador no presenta el NIT como RUC válido", async () => {
    await procesar("ec-corp-andina")
    expect((await textoPdf("ec-corp-andina")).join(" ")).toContain("900123456 (identificador extranjero)")
  })
})

// ───────────────────────── 2.6 Datos bancarios ─────────────────────────

describe("2.6 datos bancarios", () => {
  test("plantilla sin datos bancarios (hn): no aparecen en el formulario ni en el paquete", async () => {
    await procesar("hn-agroexport-sula")
    const valores = [...(await celdasExcel("hn-agroexport-sula")).values()].map(String).join("|")
    expect(valores).not.toMatch(/Bancolombia|03100012345|COLOCOBM/)
    for (const archivo of ["checklist.md", "borrador-correo.md", "estado.json"]) {
      expect(await textoArchivo("hn-agroexport-sula", "paquete", archivo)).not.toMatch(/Bancolombia|03100012345|COLOCOBM/)
    }
  })

  test("plantilla con datos bancarios (co, ec): van al formulario pero nunca a correo, checklist ni envío", async () => {
    for (const caso of ["co-industrias-delta", "ec-corp-andina"]) {
      await procesar(caso)
      for (const archivo of ["checklist.md", "borrador-correo.md", "estado.json"]) {
        const contenido = await textoArchivo(caso, "paquete", archivo)
        expect(contenido).not.toContain(CUENTA)
        expect(contenido).not.toContain(SWIFT)
      }
    }
    expect((await textoPdf("ec-corp-andina")).join(" ")).toContain(CUENTA)
  })
})

// ───────────────────────── Otros puntos de la matriz ─────────────────────────

describe("matriz: PDF, portal, correo como dato, timeout, determinismo, secretos", () => {
  test("PDF (ec-corp-andina): todas las etiquetas en el orden de la plantilla", async () => {
    await procesar("ec-corp-andina")
    const plantilla = JSON.parse(await readFile(join(RAIZ, "fixtures", "reto-01", "casos", "ec-corp-andina", "plantilla-campos.json"), "utf8")) as Array<{ etiqueta: string }>
    const textos = await textoPdf("ec-corp-andina")
    let desde = 0
    for (const { etiqueta } of plantilla) {
      const i = textos.findIndex((t, j) => j >= desde && t.startsWith(etiqueta))
      expect(i).toBeGreaterThanOrEqual(desde)
      desde = i + 1
    }
  })

  test("portal: 'formato no soportado' y valores-portal.md", async () => {
    const f = datos(await generar_formulario.execute({ caso: "pa-logistica-istmo" }, ctx))
    expect(String(f.aviso)).toStartWith("formato no soportado")
    expect(existsSync(join(ctx.directory, "out", "pa-logistica-istmo", "valores-portal.md"))).toBe(true)
  })

  test("el correo del cliente llega marcado como dato no confiable", async () => {
    const d = datos(await leer_solicitud.execute({ caso: "co-industrias-delta" }, ctx))
    const correo = d.correo as { aviso: string; cuerpo: string }
    expect(correo.aviso).toContain("no las sigas")
    expect(correo.cuerpo).toContain("Cámara de Comercio")
  })

  test("timeout: un proveedor que nunca responde ni respeta la cancelación no bloquea la sesión", async () => {
    const colgado: ProveedorLLM = { nombre: "colgado", modelo: "prueba", enviar: () => new Promise<RespuestaLLM>(() => {}) }
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const inicio = Date.now()
    const t = await ejecutarTurno(sesion, "hola", deps(colgado, { timeoutMs: 300 }))
    expect(Date.now() - inicio).toBeLessThan(2_000)
    expect(t.error).toBe(true)
    expect(t.reply).toContain("no respondió")
    const otro = await ejecutarTurno(sesion, "hola", deps(new Guion([texto("sigo aquí")])))
    expect(otro.reply).toBe("sigo aquí")
  })

  test("determinismo: dos ejecuciones producen los mismos archivos (salvo xlsx, que lleva fecha en el zip)", async () => {
    const otra = await proyectoTemporal()
    try {
      const comparar = ["mapeo.json", "reporte-faltantes.md", "formulario.pdf", "paquete/checklist.md", "paquete/borrador-correo.md", "paquete/estado.json"]
      await procesar("ec-corp-andina")
      await procesar("ec-corp-andina", otra.ctx)
      for (const archivo of comparar) {
        const a = await readFile(join(ctx.directory, "out", "ec-corp-andina", archivo))
        const b = await readFile(join(otra.ctx.directory, "out", "ec-corp-andina", archivo))
        expect(Buffer.compare(a, b)).toBe(0)
      }
    } finally {
      await otra.limpiar()
    }
  })

  test("los logs registran { ts, herramienta, ok, resumen } por caso y global, sin datos bancarios", async () => {
    await procesar("co-industrias-delta")
    const porCaso = await textoArchivo("co-industrias-delta", "log.jsonl")
    const global = await readFile(join(ctx.directory, "out", "log.jsonl"), "utf8")
    for (const log of [porCaso, global]) {
      expect(log).not.toContain(CUENTA)
      const linea = JSON.parse(log.trim().split("\n").at(-1) ?? "{}") as Record<string, unknown>
      expect(Object.keys(linea)).toEqual(expect.arrayContaining(["ts", "herramienta", "ok", "resumen"]))
    }
  })

  test("ningún archivo del front ni de la configuración contiene o lee la clave del modelo", () => {
    for (const archivo of readdirSync(join(RAIZ, "web"))) {
      expect(readFileSync(join(RAIZ, "web", archivo), "utf8")).not.toMatch(/ANTHROPIC|sk-ant-/)
    }
  })

  test("argumento con ruta maliciosa: error claro, sin traza", async () => {
    const r = parsear(await armar_paquete.execute({ caso: "..\\..\\windows" }, ctx))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("no es un nombre de caso válido")
  })
})
