/**
 * Interfaz propia del proveedor de lenguaje: `enviar(mensajes, herramientas) → respuesta`.
 * El ciclo del agente solo conoce estos tipos; cambiar de proveedor no lo toca.
 */

export type LlamadaHerramienta = { id: string; nombre: string; argumentos: unknown }

export type ResultadoHerramienta = { id: string; nombre: string; contenido: string; esError: boolean }

export type Mensaje =
  | { rol: "usuario"; texto: string }
  /** `crudo` guarda la respuesta original del proveedor para reenviarla sin cambios en el siguiente turno. */
  | { rol: "asistente"; texto: string; llamadas: LlamadaHerramienta[]; crudo?: unknown }
  | { rol: "resultados"; resultados: ResultadoHerramienta[] }

export type DefinicionHerramienta = {
  nombre: string
  descripcion: string
  esquema: Record<string, unknown>
}

export type MotivoFin = "fin_turno" | "herramientas" | "limite_tokens" | "rechazo" | "pausa"

export type RespuestaLLM = {
  texto: string
  llamadas: LlamadaHerramienta[]
  fin: MotivoFin
  uso: { entrada: number; salida: number }
  crudo?: unknown
}

export type OpcionesEnvio = {
  sistema: string
  signal?: AbortSignal
}

export interface ProveedorLLM {
  readonly nombre: string
  readonly modelo: string
  enviar(mensajes: Mensaje[], herramientas: DefinicionHerramienta[], opciones: OpcionesEnvio): Promise<RespuestaLLM>
  /** Opcional: qué está haciendo el proveedor ahora (para diagnosticar un timeout). Nunca incluye claves. */
  estado?(): string
  /** Opcional: verificación al arrancar (p. ej. qué modelos acepta la clave). */
  preparar?(): Promise<void>
  /** Opcional: datos de diagnóstico sin secretos para /api/health. */
  diagnostico?(): Record<string, unknown>
}

/** Error del proveedor con un mensaje apto para mostrar al usuario (nunca incluye la clave). */
export class ErrorProveedor extends Error {
  constructor(
    mensaje: string,
    readonly reintentable: boolean = false,
  ) {
    super(mensaje)
    this.name = "ErrorProveedor"
  }
}
