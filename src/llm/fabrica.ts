import type { Config } from "../config"
import type { ProveedorLLM } from "./adapter"
import { ProveedorAnthropic } from "./anthropic"
import { ProveedorGemini } from "./gemini"
import { ProveedorSimulado } from "./simulado"

type Entorno = Record<string, string | undefined>
type NombreProveedor = "gemini" | "anthropic" | "simulado"

const MODELO_POR_DEFECTO: Record<Exclude<NombreProveedor, "simulado">, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "claude-opus-5-5",
}

function tieneClave(proveedor: NombreProveedor, entorno: Entorno): boolean {
  if (proveedor === "gemini") return Boolean(entorno.GEMINI_API_KEY?.trim() || entorno.GOOGLE_API_KEY?.trim())
  if (proveedor === "anthropic") return Boolean(entorno.ANTHROPIC_API_KEY?.trim() || entorno.ANTHROPIC_AUTH_TOKEN?.trim())
  return true
}

/**
 * Decide qué proveedor usar. "auto": Gemini si hay GEMINI_API_KEY, si no Anthropic si hay su clave,
 * si no el simulado. Solo mira si la clave existe; nunca la lee ni la devuelve.
 */
export function elegirProveedor(config: Config, entorno: Entorno): { proveedor: NombreProveedor; aviso?: string } {
  const pedido = config.LLM_PROVIDER
  if (pedido === "simulado") return { proveedor: "simulado" }
  if (pedido === "auto") {
    if (tieneClave("gemini", entorno)) return { proveedor: "gemini" }
    if (tieneClave("anthropic", entorno)) return { proveedor: "anthropic" }
    return { proveedor: "simulado", aviso: "No hay GEMINI_API_KEY ni ANTHROPIC_API_KEY: se usa el proveedor simulado (sin modelo de lenguaje)." }
  }
  if (tieneClave(pedido, entorno)) return { proveedor: pedido }
  return { proveedor: "simulado", aviso: `LLM_PROVIDER=${pedido} pero falta su clave: se usa el proveedor simulado (sin modelo de lenguaje).` }
}

export function crearProveedor(config: Config, entorno: Entorno, casos: () => Promise<string[]>): { proveedor: ProveedorLLM; aviso?: string } {
  const { proveedor, aviso } = elegirProveedor(config, entorno)
  if (proveedor === "simulado") return { proveedor: new ProveedorSimulado(casos), aviso }
  const modelo = config.LLM_MODEL ?? MODELO_POR_DEFECTO[proveedor]
  if (proveedor === "gemini") {
    return { proveedor: new ProveedorGemini({ modelo, maxTokensRespuesta: config.LLM_MAX_TOKENS_RESPUESTA, reintentos: 2, esperaBaseMs: 8000 }) }
  }
  return {
    proveedor: new ProveedorAnthropic({ modelo, esfuerzo: config.LLM_EFFORT, maxTokensRespuesta: config.LLM_MAX_TOKENS_RESPUESTA, timeoutMs: config.LLM_TIMEOUT_MS }),
  }
}
