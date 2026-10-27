/**
 * Adaptador de Gemini probado con un cliente falso (sin red ni clave): conversión de mensajes,
 * conservación de "thought signatures", reintentos ante 429, errores claros y flujo completo del ciclo.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ApiError, ThinkingLevel, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from "@google/genai"
import { ejecutarTurno } from "../src/agent/ciclo"
import { AlmacenSesiones } from "../src/agent/sesiones"
import { cargarConfig } from "../src/config"
import type { ContextoHerramienta } from "../src/dominio/contexto"
import { ErrorProveedor } from "../src/llm/adapter"
import { elegirProveedor } from "../src/llm/fabrica"
import { aContenidos, configuracionRazonamiento, deRespuesta, elegirModelo, ProveedorGemini, type ClienteGemini } from "../src/llm/gemini"
import { cargarHerramientas } from "../src/tools/registro"
import { proyectoTemporal } from "./utilidades"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>
beforeAll(async () => {
  const p = await proyectoTemporal()
  ctx = p.ctx
  limpiar = p.limpiar
})
afterAll(() => limpiar())

function respuesta(parts: Part[], finishReason = "STOP"): GenerateContentResponse {
  return { candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 } } as GenerateContentResponse
}
const llamada = (name: string, args: Record<string, unknown>, firma?: string): Part => ({ functionCall: { id: `fc-${name}`, name, args }, ...(firma ? { thoughtSignature: firma } : {}) })

/** Cliente falso: devuelve respuestas en orden y guarda cada solicitud recibida. */
class ClienteFalso implements ClienteGemini {
  readonly solicitudes: GenerateContentParameters[] = []
  constructor(private readonly guion: Array<GenerateContentResponse | Error>) {}
  async generateContent(p: GenerateContentParameters): Promise<GenerateContentResponse> {
    this.solicitudes.push(structuredClone({ ...p, config: { ...p.config, abortSignal: undefined } }))
    const siguiente = this.guion.shift()
    if (!siguiente) throw new Error("guion agotado")
    if (siguiente instanceof Error) throw siguiente
    return siguiente
  }
}

const config = { modelo: "gemini-3.8-flash", maxTokensRespuesta: 1000, esfuerzo: "low" as const, reintentos: 2, esperaBaseMs: 1 }

describe("conversión de mensajes", () => {
  test("lee llamadas a funciones, uso de tokens y conserva la firma de pensamiento", () => {
    const r = deRespuesta(respuesta([{ text: "pensando", thought: true }, llamada("proveedor_leer_solicitud", { caso: "x" }, "FIRMA-1")]))
    expect(r.fin).toBe("herramientas")
    expect(r.texto).toBe("")
    expect(r.llamadas).toEqual([{ id: "fc-proveedor_leer_solicitud", nombre: "proveedor_leer_solicitud", argumentos: { caso: "x" } }])
    expect(r.uso).toEqual({ entrada: 100, salida: 25 })
    expect(JSON.stringify(r.crudo)).toContain("FIRMA-1")
  })

  test("el contenido del modelo se reenvía sin cambios y los resultados van juntos como functionResponse", () => {
    const crudo: Content = { role: "model", parts: [llamada("a", {}, "FIRMA-A"), { functionCall: { name: "b", args: {} } }] }
    const contenidos = aContenidos([
      { rol: "usuario", texto: "hola" },
      { rol: "asistente", texto: "", llamadas: [], crudo },
      {
        rol: "resultados",
        resultados: [
          { id: "fc-a", nombre: "a", contenido: '{"ok":true,"data":{"x":1}}', esError: false },
          { id: "local-123", nombre: "b", contenido: '{"ok":false,"error":"no"}', esError: true },
        ],
      },
      { rol: "usuario", texto: "sigue" },
    ])
    expect(contenidos).toHaveLength(3)
    expect(contenidos[1]).toBe(crudo)
    const ultimo = contenidos[2]?.parts ?? []
    expect(ultimo[0]?.functionResponse).toEqual({ id: "fc-a", name: "a", response: { output: { ok: true, data: { x: 1 } } } })
    expect(ultimo[1]?.functionResponse).toEqual({ name: "b", response: { error: { ok: false, error: "no" } } })
    expect(ultimo[2]).toEqual({ text: "sigue" })
  })

  test("un bloqueo de seguridad se informa como rechazo", () => {
    expect(deRespuesta(respuesta([], "SAFETY")).fin).toBe("rechazo")
    expect(deRespuesta(respuesta([{ text: "corte" }], "MAX_TOKENS")).fin).toBe("limite_tokens")
  })
})

describe("errores y límites de la capa gratuita", () => {
  test("reintenta ante 429 y luego responde", async () => {
    const cliente = new ClienteFalso([new ApiError({ message: "quota", status: 429 }), respuesta([{ text: "listo" }])])
    const r = await new ProveedorGemini(config, cliente).enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" })
    expect(r.texto).toBe("listo")
    expect(cliente.solicitudes).toHaveLength(2)
  })

  test("si la cuota sigue agotada, explica el límite gratuito", async () => {
    const cuota = () => new ApiError({ message: "quota", status: 429 })
    const cliente = new ClienteFalso([cuota(), cuota(), cuota()])
    const promesa = new ProveedorGemini(config, cliente).enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" })
    expect(promesa).rejects.toThrow("límite de la capa gratuita")
    await promesa.catch(() => {})
  })

  test("clave inválida: mensaje claro y sin reintentos", async () => {
    const cliente = new ClienteFalso([new ApiError({ message: "API key not valid. Please pass a valid API key.", status: 400 })])
    const error = await new ProveedorGemini(config, cliente).enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorProveedor)
    expect((error as ErrorProveedor).message).toContain("clave de Gemini es inválida")
    expect(cliente.solicitudes).toHaveLength(1)
  })
})

describe("flujo completo del ciclo con Gemini (cliente falso)", () => {
  test("procesa el caso, pide confirmación y solo envía tras el 'envía'", async () => {
    const caso = "ec-corp-andina"
    const cliente = new ClienteFalso([
      respuesta([llamada("proveedor_leer_solicitud", { caso }, "FIRMA-LEER")]),
      respuesta([llamada("proveedor_mapear_campos", { caso, campos: [] })]),
      respuesta([llamada("proveedor_generar_formulario", { caso })]),
      respuesta([llamada("proveedor_armar_paquete", { caso })]),
      respuesta([{ text: `Resumen del caso.\n\n**Confirmación requerida:** ¿Confirmas que simule el envío del paquete de ${caso}?` }]),
      respuesta([llamada("proveedor_simular_envio", { caso, confirmado: true })]),
      respuesta([{ text: "Envío simulado." }]),
    ])
    const deps = {
      proveedor: new ProveedorGemini(config, cliente),
      herramientas: cargarHerramientas(),
      sistema: "prueba",
      directorio: ctx.directory,
      fechaReferencia: ctx.fechaReferencia,
      maxIteraciones: 10,
      maxTokensSesion: 1_000_000,
      timeoutMs: 5_000,
    }
    const sesion = new AlmacenSesiones(5).obtenerOCrear()

    const t1 = await ejecutarTurno(sesion, `Procesa el caso "${caso}". No envíes nada todavía.`, deps)
    expect(t1.toolCalls.map((c) => c.ok)).toEqual([true, true, true, true])
    expect(t1.pendingAction).toEqual({ herramienta: "proveedor_simular_envio", caso })
    expect(existsSync(join(ctx.directory, "out", caso, "ENVIO-SIMULADO.md"))).toBe(false)

    // La segunda solicitud debe llevar la firma de pensamiento de la primera respuesta, intacta.
    expect(JSON.stringify(cliente.solicitudes[1]?.contents)).toContain("FIRMA-LEER")
    expect(cliente.solicitudes[0]?.config?.tools).toBeDefined()

    const t2 = await ejecutarTurno(sesion, "envía", deps)
    expect(t2.toolCalls[0]?.ok).toBe(true)
    expect(existsSync(join(ctx.directory, "out", caso, "ENVIO-SIMULADO.md"))).toBe(true)
  })
})

describe("elección de proveedor (sin exponer claves)", () => {
  const base = cargarConfig({})
  test.each([
    [{ GEMINI_API_KEY: "clave-de-prueba-123" }, "gemini"],
    [{ ANTHROPIC_API_KEY: "clave-de-prueba-123" }, "anthropic"],
    [{ GEMINI_API_KEY: "clave-de-prueba-123", ANTHROPIC_API_KEY: "otra-clave-456" }, "gemini"],
    [{}, "simulado"],
  ])("auto con %p → %s", (entorno, esperado) => {
    const r = elegirProveedor(base, entorno)
    expect(r.proveedor).toBe(esperado as "gemini" | "anthropic" | "simulado")
    expect(JSON.stringify(r)).not.toContain("clave-de-prueba-123")
  })

  test("pedir gemini sin clave avisa y usa el simulado", () => {
    const r = elegirProveedor(cargarConfig({ LLM_PROVIDER: "gemini" }), {})
    expect(r.proveedor).toBe("simulado")
    expect(r.aviso).toContain("falta su clave")
  })
})

describe("nivel de razonamiento según el modelo", () => {
  test("Gemini 3.x usa thinkingLevel y 2.5 usa thinkingBudget", () => {
    expect(configuracionRazonamiento("gemini-3.8-flash", "low")).toEqual({ thinkingLevel: ThinkingLevel.LOW })
    expect(configuracionRazonamiento("gemini-2.5-flash", "low")).toEqual({ thinkingBudget: 1024 })
    expect(configuracionRazonamiento("gemini-2.5-pro", "minimal")).toEqual({ thinkingBudget: 128 })
    expect(configuracionRazonamiento("otro-modelo", "low")).toBeUndefined()
  })

  test("la solicitud a Gemini lleva el nivel configurado", async () => {
    const cliente = new ClienteFalso([respuesta([{ text: "ok" }])])
    await new ProveedorGemini(config, cliente).enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" })
    expect(cliente.solicitudes[0]?.config?.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW })
  })

  test("sin LLM_EFFORT, Gemini usa 'low' por defecto", () => {
    expect(cargarConfig({}).LLM_EFFORT).toBeUndefined()
    expect(cargarConfig({ LLM_EFFORT: "" }).LLM_EFFORT).toBeUndefined()
  })
})

describe("elección automática de modelo según la clave", () => {
  const listado = (nombres: string[]) => async () =>
    (async function* () {
      for (const n of nombres) yield { name: `models/${n}`, supportedActions: ["generateContent"] }
    })()

  test("si el modelo configurado no existe para la clave, al arrancar elige el preferido disponible", async () => {
    const cliente = Object.assign(new ClienteFalso([respuesta([{ text: "ok" }])]), { list: listado(["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-embedding-2"]) })
    const p = new ProveedorGemini({ ...config, modelo: "gemini-2.5-flash" }, cliente)
    await p.preparar()
    expect(p.modelo).toBe("gemini-3.5-flash-lite")
    expect(p.diagnostico()).toEqual({ modeloConfigurado: "gemini-2.5-flash", modelosDisponibles: ["gemini-3.8-flash", "gemini-3.5-flash-lite"] })
    await p.enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" })
    expect(cliente.solicitudes[0]?.model).toBe("gemini-3.5-flash-lite")
  })

  test("si el modelo configurado existe, no se cambia", async () => {
    const cliente = Object.assign(new ClienteFalso([]), { list: listado(["gemini-2.5-flash", "gemini-3.6-flash"]) })
    const p = new ProveedorGemini({ ...config, modelo: "gemini-2.5-flash" }, cliente)
    await p.preparar()
    expect(p.modelo).toBe("gemini-2.5-flash")
  })

  test("un 404 en plena solicitud cambia de modelo y reintenta", async () => {
    const cliente = Object.assign(new ClienteFalso([new ApiError({ message: "not found", status: 404 }), respuesta([{ text: "listo" }])]), { list: listado(["gemini-3.6-flash"]) })
    const p = new ProveedorGemini({ ...config, modelo: "gemini-2.5-flash" }, cliente)
    const r = await p.enviar([{ rol: "usuario", texto: "hola" }], [], { sistema: "s" })
    expect(r.texto).toBe("listo")
    expect(cliente.solicitudes.map((s) => s.model)).toEqual(["gemini-2.5-flash", "gemini-3.6-flash"])
  })

  test("elegirModelo descarta modelos de imagen, audio y los ya probados", () => {
    expect(elegirModelo(["gemini-3.1-flash-image", "gemini-9-flash"], [])).toBe("gemini-9-flash")
    expect(elegirModelo(["gemini-3.6-flash"], ["gemini-3.6-flash"])).toBeNull()
  })
})
