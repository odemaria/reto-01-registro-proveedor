import Anthropic from "@anthropic-ai/sdk"
import {
  ErrorProveedor,
  type DefinicionHerramienta,
  type Mensaje,
  type MotivoFin,
  type OpcionesEnvio,
  type ProveedorLLM,
  type RespuestaLLM,
} from "./adapter"

type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max"
type BloqueAsistente = Anthropic.Beta.BetaContentBlockParam
type MensajeApi = Anthropic.Beta.BetaMessageParam

export type ConfigAnthropic = {
  modelo: string
  esfuerzo: Esfuerzo
  maxTokensRespuesta: number
  timeoutMs: number
}

/**
 * Implementación del adaptador para Claude (Anthropic Messages API).
 * La clave se lee de ANTHROPIC_API_KEY dentro del SDK: nunca pasa por este código ni por los logs.
 */
export class ProveedorAnthropic implements ProveedorLLM {
  readonly nombre = "anthropic"
  readonly modelo: string
  private readonly cliente: Anthropic

  constructor(private readonly config: ConfigAnthropic) {
    this.modelo = config.modelo
    this.cliente = new Anthropic({ timeout: config.timeoutMs, maxRetries: 1 })
  }

  async enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLLM> {
    try {
      const respuesta = await this.cliente.beta.messages.create(
        {
          model: this.modelo,
          max_tokens: this.config.maxTokensRespuesta,
          system: [{ type: "text", text: opciones.sistema, cache_control: { type: "ephemeral" } }],
          tools: herramientas.map((h) => ({ name: h.nombre, description: h.descripcion, input_schema: h.esquema as Anthropic.Beta.BetaTool.InputSchema })),
          messages: aMensajesApi(mensajes),
          output_config: { effort: this.config.esfuerzo },
          // Si el modelo declina por política, la API reintenta con un modelo de respaldo en la misma llamada.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: opciones.signal },
      )
      return deRespuestaApi(respuesta)
    } catch (error) {
      throw traducirError(error)
    }
  }
}

function aMensajesApi(mensajes: Mensaje[]): MensajeApi[] {
  return mensajes.map((m): MensajeApi => {
    if (m.rol === "usuario") return { role: "user", content: m.texto }
    if (m.rol === "resultados") {
      return {
        role: "user",
        content: m.resultados.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.contenido, is_error: r.esError })),
      }
    }
    // Se reenvía el contenido original (incluye bloques de pensamiento) para no editar el historial.
    if (Array.isArray(m.crudo)) return { role: "assistant", content: m.crudo as BloqueAsistente[] }
    const bloques: BloqueAsistente[] = []
    if (m.texto) bloques.push({ type: "text", text: m.texto })
    for (const l of m.llamadas) bloques.push({ type: "tool_use", id: l.id, name: l.nombre, input: l.argumentos ?? {} })
    return { role: "assistant", content: bloques }
  })
}

const MOTIVOS: Record<string, MotivoFin> = {
  end_turn: "fin_turno",
  stop_sequence: "fin_turno",
  tool_use: "herramientas",
  max_tokens: "limite_tokens",
  refusal: "rechazo",
  pause_turn: "pausa",
}

function deRespuestaApi(respuesta: Anthropic.Beta.BetaMessage): RespuestaLLM {
  const textos: string[] = []
  const llamadas: RespuestaLLM["llamadas"] = []
  for (const bloque of respuesta.content) {
    if (bloque.type === "text") textos.push(bloque.text)
    if (bloque.type === "tool_use") llamadas.push({ id: bloque.id, nombre: bloque.name, argumentos: bloque.input })
  }
  return {
    texto: textos.join("\n").trim(),
    llamadas,
    fin: MOTIVOS[respuesta.stop_reason ?? "end_turn"] ?? "fin_turno",
    uso: { entrada: respuesta.usage.input_tokens, salida: respuesta.usage.output_tokens },
    crudo: respuesta.content,
  }
}

function traducirError(error: unknown): ErrorProveedor {
  if (error instanceof Anthropic.APIUserAbortError) return new ErrorProveedor("La consulta al modelo se canceló por tiempo de espera.", true)
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new ErrorProveedor("El modelo tardó demasiado en responder. Intenta de nuevo.", true)
  if (error instanceof Anthropic.APIConnectionError) return new ErrorProveedor("No hay conexión con el proveedor del modelo. Revisa la red e intenta de nuevo.", true)
  if (error instanceof Anthropic.AuthenticationError) return new ErrorProveedor("La clave del proveedor es inválida o no está configurada en el servidor.")
  if (error instanceof Anthropic.PermissionDeniedError) return new ErrorProveedor("La clave del proveedor no tiene permiso para usar este modelo.")
  if (error instanceof Anthropic.RateLimitError) return new ErrorProveedor("El proveedor está limitando las solicitudes. Espera un momento e intenta de nuevo.", true)
  if (error instanceof Anthropic.BadRequestError) return new ErrorProveedor("El proveedor rechazó la solicitud (formato o modelo no válido).")
  if (error instanceof Anthropic.InternalServerError) return new ErrorProveedor("El proveedor del modelo tuvo un error interno. Intenta de nuevo.", true)
  if (error instanceof Anthropic.APIError) return new ErrorProveedor(`El proveedor devolvió un error (${error.status ?? "sin código"}).`, true)
  return new ErrorProveedor("Error inesperado al consultar el modelo.")
}
