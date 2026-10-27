import { ApiError, GoogleGenAI, type Content, type GenerateContentParameters, type GenerateContentResponse, type Part } from "@google/genai"
import {
  ErrorProveedor,
  type DefinicionHerramienta,
  type LlamadaHerramienta,
  type Mensaje,
  type MotivoFin,
  type OpcionesEnvio,
  type ProveedorLLM,
  type RespuestaLLM,
  type ResultadoHerramienta,
} from "./adapter"

/** Lo único que el adaptador usa del SDK: permite inyectar un cliente falso en las pruebas. */
export type ClienteGemini = { generateContent(parametros: GenerateContentParameters): Promise<GenerateContentResponse> }

export type ConfigGemini = {
  modelo: string
  maxTokensRespuesta: number
  /** Reintentos ante 429/503 (la capa gratuita tiene pocas solicitudes por minuto). */
  reintentos: number
  esperaBaseMs: number
}

/** Prefijo de los ids que inventa el adaptador cuando Gemini no devuelve id en la llamada. */
const ID_LOCAL = "local-"
const FINES_RECHAZO = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY", "LANGUAGE"])

/**
 * Implementación del adaptador para Google Gemini (API gratuita de Google AI Studio).
 * La clave se lee de GEMINI_API_KEY solo aquí, se pasa al SDK y nunca se registra ni se devuelve.
 */
export class ProveedorGemini implements ProveedorLLM {
  readonly nombre = "gemini"
  readonly modelo: string
  private readonly cliente: ClienteGemini
  private ultimoEstado = "sin solicitudes todavía"

  constructor(
    private readonly config: ConfigGemini,
    cliente?: ClienteGemini,
  ) {
    this.modelo = config.modelo
    this.cliente = cliente ?? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY }).models
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLLM> {
    const parametros: GenerateContentParameters = {
      model: this.modelo,
      contents: aContenidos(mensajes),
      config: {
        systemInstruction: opciones.sistema,
        tools: [{ functionDeclarations: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, parametersJsonSchema: h.esquema })) }],
        automaticFunctionCalling: { disable: true },
        maxOutputTokens: this.config.maxTokensRespuesta,
        abortSignal: opciones.signal,
      },
    }
    for (let intento = 1; ; intento++) {
      const inicio = Date.now()
      this.ultimoEstado = `esperando la respuesta de Gemini (${this.modelo}, intento ${intento})`
      try {
        const respuesta = deRespuesta(await this.cliente.generateContent(parametros))
        const ms = Date.now() - inicio
        this.ultimoEstado = `última respuesta de Gemini en ${ms} ms`
        registrarLlm(`modelo=${this.modelo} intento=${intento} ms=${ms} fin=${respuesta.fin} llamadas=${respuesta.llamadas.length} tokens=${respuesta.uso.entrada}+${respuesta.uso.salida}`)
        return respuesta
      } catch (error) {
        const traducido = traducirError(error)
        const ms = Date.now() - inicio
        const espera = this.config.esperaBaseMs * 2 ** (intento - 1)
        const reintenta = traducido.reintentable && intento <= this.config.reintentos && !opciones.signal?.aborted
        this.ultimoEstado = `Gemini respondió error ${descripcionError(error)} en el intento ${intento}${reintenta ? `; reintentando en ${Math.round(espera / 1000)} s` : ""}`
        registrarLlm(`modelo=${this.modelo} intento=${intento} ms=${ms} error=${descripcionError(error)} detalle="${detalleError(error)}"`)
        if (!reintenta) throw traducido
        await esperar(espera, opciones.signal)
      }
    }
  }

  estado(): string {
    return this.ultimoEstado
  }
}

/** Diagnóstico en los logs del servidor: tiempos, estado y códigos. Nunca la clave ni el contenido. */
function registrarLlm(texto: string): void {
  console.log(`[llm] gemini ${texto}`)
}

function descripcionError(error: unknown): string {
  if (error instanceof ApiError) return String(error.status)
  if (error instanceof Error) return error.name
  return "desconocido"
}

function detalleError(error: unknown): string {
  const mensaje = error instanceof Error ? error.message : String(error)
  return mensaje.replace(/key=[^&\s"]+/gi, "key=***").replace(/\s+/g, " ").slice(0, 240)
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    const t = setTimeout(resolver, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(t)
      resolver()
    })
  })
}

// ───────────────────────── historial propio → contenidos de Gemini ─────────────────────────

function esContenido(valor: unknown): valor is Content {
  return typeof valor === "object" && valor !== null && Array.isArray((valor as Content).parts)
}

function respuestaDe(r: ResultadoHerramienta): Record<string, unknown> {
  let datos: unknown
  try {
    datos = JSON.parse(r.contenido)
  } catch {
    datos = r.contenido
  }
  return r.esError ? { error: datos } : { output: datos }
}

function contenidoDe(m: Mensaje): Content {
  if (m.rol === "usuario") return { role: "user", parts: [{ text: m.texto }] }
  if (m.rol === "resultados") {
    return {
      role: "user",
      parts: m.resultados.map((r) => ({
        functionResponse: { ...(r.id.startsWith(ID_LOCAL) ? {} : { id: r.id }), name: r.nombre, response: respuestaDe(r) },
      })),
    }
  }
  // Se reenvía el contenido original del modelo sin tocarlo: conserva las "thought signatures".
  if (esContenido(m.crudo)) return m.crudo
  const parts: Part[] = []
  if (m.texto) parts.push({ text: m.texto })
  for (const l of m.llamadas) {
    parts.push({ functionCall: { ...(l.id.startsWith(ID_LOCAL) ? {} : { id: l.id }), name: l.nombre, args: (l.argumentos ?? {}) as Record<string, unknown> } })
  }
  return { role: "model", parts }
}

/** Une turnos consecutivos del usuario (p. ej. resultados + nuevo mensaje tras un error). Los del modelo nunca se tocan. */
export function aContenidos(mensajes: Mensaje[]): Content[] {
  const contenidos: Content[] = []
  for (const m of mensajes) {
    const actual = contenidoDe(m)
    const previo = contenidos.at(-1)
    if (previo && previo.role === "user" && actual.role === "user") previo.parts = [...(previo.parts ?? []), ...(actual.parts ?? [])]
    else contenidos.push(actual.role === "user" ? { role: "user", parts: [...(actual.parts ?? [])] } : actual)
  }
  return contenidos
}

// ───────────────────────── respuesta de Gemini → respuesta propia ─────────────────────────

export function deRespuesta(respuesta: GenerateContentResponse): RespuestaLLM {
  const candidato = respuesta.candidates?.[0]
  const partes = candidato?.content?.parts ?? []
  const texto = partes.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim()
  const llamadas: LlamadaHerramienta[] = partes
    .filter((p): p is Part & { functionCall: NonNullable<Part["functionCall"]> } => p.functionCall !== undefined)
    .map((p) => ({ id: p.functionCall.id ?? `${ID_LOCAL}${crypto.randomUUID()}`, nombre: p.functionCall.name ?? "", argumentos: p.functionCall.args ?? {} }))

  const finCrudo = String(candidato?.finishReason ?? "STOP")
  let fin: MotivoFin = "fin_turno"
  if (respuesta.promptFeedback?.blockReason || (llamadas.length === 0 && FINES_RECHAZO.has(finCrudo))) fin = "rechazo"
  else if (llamadas.length > 0) fin = "herramientas"
  else if (finCrudo === "MAX_TOKENS") fin = "limite_tokens"

  const uso = respuesta.usageMetadata
  return {
    texto,
    llamadas,
    fin,
    uso: { entrada: uso?.promptTokenCount ?? 0, salida: (uso?.candidatesTokenCount ?? 0) + (uso?.thoughtsTokenCount ?? 0) },
    crudo: { role: "model", parts: partes },
  }
}

function traducirError(error: unknown): ErrorProveedor {
  if (error instanceof ErrorProveedor) return error
  if (error instanceof Error && error.name === "AbortError") return new ErrorProveedor("La consulta al modelo se canceló por tiempo de espera.", false)
  if (error instanceof ApiError) {
    const s = error.status
    if (s === 400 && /api key/i.test(error.message)) return new ErrorProveedor("La clave de Gemini es inválida o no está configurada en el servidor.")
    if (s === 401 || s === 403) return new ErrorProveedor("La clave de Gemini es inválida o no tiene permiso para este modelo.")
    if (s === 404) return new ErrorProveedor("El modelo de Gemini configurado no existe o no está disponible para esta clave.")
    if (s === 429) return new ErrorProveedor("Se alcanzó el límite de la capa gratuita de Gemini. Espera un minuto e intenta de nuevo.", true)
    if (s >= 500) return new ErrorProveedor("El servicio de Gemini no está disponible en este momento. Intenta de nuevo.", true)
    return new ErrorProveedor(`Gemini rechazó la solicitud (${s}).`)
  }
  return new ErrorProveedor("No hay conexión con el proveedor del modelo. Revisa la red e intenta de nuevo.", true)
}
