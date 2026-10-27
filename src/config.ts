import { z } from "zod"
import { esFechaValida } from "./dominio/fechas"

/**
 * Configuración desde variables de entorno (ver .env.example).
 * Las claves de los proveedores (GEMINI_API_KEY, ANTHROPIC_API_KEY) NO se guardan aquí: solo las
 * leen los adaptadores al crear el cliente, así nunca terminan en configuración, logs ni respuestas.
 */
const esquema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LLM_PROVIDER: z.enum(["auto", "gemini", "anthropic", "simulado"]).default("auto"),
  /** Vacío = modelo por defecto del proveedor (gemini-3.8-flash o claude-opus-5-5). */
  LLM_MODEL: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
  /** Vacío = por defecto del proveedor: "low" en Gemini (respuestas rápidas), "medium" en Anthropic. */
  LLM_EFFORT: z
    .union([z.literal(""), z.enum(["minimal", "low", "medium", "high", "xhigh", "max"])])
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  LLM_MAX_TOKENS_RESPUESTA: z.coerce.number().int().min(1024).max(64000).default(16000),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(5000).default(90000),
  MAX_ITERACIONES: z.coerce.number().int().min(1).max(100).default(25),
  MAX_TOKENS_SESION: z.coerce.number().int().min(10000).default(400000),
  MAX_SESIONES: z.coerce.number().int().min(1).default(200),
  MAX_MENSAJES_POR_MINUTO: z.coerce.number().int().min(1).default(20),
  FECHA_REFERENCIA: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined))
    .refine((v) => v === undefined || esFechaValida(v), "FECHA_REFERENCIA debe tener formato AAAA-MM-DD"),
  APP_ACCESS_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined)),
})

export type Config = z.infer<typeof esquema>

export function cargarConfig(entorno: Record<string, string | undefined> = process.env): Config {
  const r = esquema.safeParse(entorno)
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Configuración inválida: ${detalle}`)
  }
  return r.data
}
