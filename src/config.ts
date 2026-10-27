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
  /** Vacío = modelo por defecto del proveedor (gemini-2.5-flash o claude-opus-5-5). */
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

/** Variables con opciones fijas: un error de tipeo en el panel del hosting no debe tumbar el servicio. */
const OPCIONES_TOLERANTES: Record<string, readonly string[]> = {
  LLM_PROVIDER: ["auto", "gemini", "anthropic", "simulado"],
  LLM_EFFORT: ["minimal", "low", "medium", "high", "xhigh", "max"],
}

/** Quita espacios y comillas sobrantes y pasa a minúsculas: " Gemini" o "\"auto\"" se leen bien. */
function normalizar(valor: string | undefined): string | undefined {
  return valor?.trim().replace(/^["']+|["']+$/g, "").trim().toLowerCase()
}

/**
 * Corrige lo corregible y, si una variable con opciones fijas trae un valor desconocido, avisa
 * (mostrando el valor recibido: estas variables no son secretas) y usa el valor por defecto.
 */
export function sanearEntorno(entorno: Record<string, string | undefined>, avisar: (m: string) => void = console.warn): Record<string, string | undefined> {
  const limpio = { ...entorno }
  if (limpio.LLM_MODEL !== undefined) limpio.LLM_MODEL = normalizar(limpio.LLM_MODEL)
  for (const [clave, permitidos] of Object.entries(OPCIONES_TOLERANTES)) {
    const valor = normalizar(limpio[clave])
    if (!valor) {
      delete limpio[clave]
    } else if (permitidos.includes(valor)) {
      limpio[clave] = valor
    } else {
      avisar(`⚠ ${clave}="${valor.slice(0, 40)}" no es válido (opciones: ${permitidos.join(" | ")}); se usa el valor por defecto.`)
      delete limpio[clave]
    }
  }
  return limpio
}

export function cargarConfig(entorno: Record<string, string | undefined> = process.env, avisar: (m: string) => void = console.warn): Config {
  const r = esquema.safeParse(sanearEntorno(entorno, avisar))
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    throw new Error(`Configuración inválida: ${detalle}`)
  }
  return r.data
}
