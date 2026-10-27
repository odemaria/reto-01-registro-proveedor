/**
 * Confirmación humana (CA3 / RN4). La decide el código, no el modelo:
 * 1. El agente termina un turno pidiendo confirmar una acción concreta (simular el envío de un caso)
 *    → la sesión guarda esa ACCIÓN PENDIENTE { herramienta, caso }.
 * 2. El siguiente mensaje del usuario es afirmativo y no menciona otro caso → AUTORIZACIÓN válida
 *    solo durante ese turno, solo para ese caso y para un único uso.
 * Cualquier otra cosa (sin acción pendiente, negación, otro caso, otra acción) → no hay autorización.
 */

export type AccionPendiente = {
  /** Herramienta que se pidió confirmar; null si la pregunta no era sobre una acción externa. */
  herramienta: string | null
  caso: string | null
}

export type Autorizacion = { herramienta: string; caso: string; usada: boolean }

export type EvaluacionConfirmacion = { autorizacion: Autorizacion | null; motivo: string }

const HERRAMIENTA_ENVIO = "proveedor_simular_envio"

export function normal(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

const NEGACION = /\b(no|cancela|cancelar|espera|esperar|todavia|detente|nunca)\b/
const AFIRMACION = /\b(si|confirmo|confirmado|confirmada|envia|envialo|enviala|enviar|adelante|procede|proceder|dale|ok|okay|de acuerdo|autorizo|hazlo)\b/

export function esConfirmacion(texto: string): boolean {
  const t = normal(texto).trim()
  if (t.length === 0 || t.length > 200) return false
  return !NEGACION.test(t) && AFIRMACION.test(t)
}

/** El agente pide confirmación con la marca acordada en el prompt, o con una pregunta explícita de confirmación. */
export function pideConfirmacion(respuesta: string): boolean {
  const t = normal(respuesta)
  if (t.includes("confirmacion requerida")) return true
  const ultima = t.trim().split("\n").filter(Boolean).at(-1) ?? ""
  return ultima.includes("?") && /(confirm|autoriz|procedo|envie|envio|enviar)/.test(ultima)
}

/** Casos que se nombran en un texto (por nombre exacto de carpeta). */
export function casosMencionados(texto: string, casos: string[]): string[] {
  const t = normal(texto)
  return casos.filter((c) => t.includes(c))
}

/**
 * Qué acción quedó pendiente al terminar el turno del agente. Solo es un envío si la pregunta habla
 * de enviar y se puede saber de qué caso: el que nombra la pregunta o, si no nombra ninguno, el
 * último paquete armado en la sesión.
 */
export function accionPendienteDe(respuesta: string, casos: string[], ultimoCasoArmado: string | null): AccionPendiente {
  const t = normal(respuesta)
  const pregunta = t.slice(Math.max(0, t.lastIndexOf("confirmacion requerida")))
  if (!/envi|envio|simul/.test(pregunta)) return { herramienta: null, caso: null }
  const nombrados = casosMencionados(pregunta, casos)
  const caso = nombrados.length === 1 ? (nombrados[0] ?? null) : nombrados.length === 0 ? ultimoCasoArmado : null
  return caso ? { herramienta: HERRAMIENTA_ENVIO, caso } : { herramienta: null, caso: null }
}

export function evaluarConfirmacion(pendiente: AccionPendiente | null, mensaje: string, casos: string[]): EvaluacionConfirmacion {
  if (!pendiente) return { autorizacion: null, motivo: "no había ninguna acción pendiente de confirmar en el turno anterior" }
  if (!esConfirmacion(mensaje)) return { autorizacion: null, motivo: "el último mensaje del usuario no es una confirmación explícita" }
  if (!pendiente.herramienta || !pendiente.caso) return { autorizacion: null, motivo: "la pregunta anterior no pedía confirmar un envío" }
  const otros = casosMencionados(mensaje, casos).filter((c) => c !== pendiente.caso)
  if (otros.length > 0) {
    return { autorizacion: null, motivo: `el usuario mencionó otro caso (${otros.join(", ")}); la confirmación pendiente era para ${pendiente.caso}` }
  }
  return { autorizacion: { herramienta: pendiente.herramienta, caso: pendiente.caso, usada: false }, motivo: "confirmado" }
}

/** Revisa una llamada concreta contra la autorización vigente. Devuelve el motivo del rechazo o null si procede. */
export function rechazoDeLlamada(nombre: string, argumentos: unknown, evaluacion: EvaluacionConfirmacion): string | null {
  const a = evaluacion.autorizacion
  if (!a) return evaluacion.motivo
  if (a.herramienta !== nombre) return `la confirmación fue para ${a.herramienta}, no para ${nombre}`
  const caso = typeof argumentos === "object" && argumentos !== null ? (argumentos as { caso?: unknown }).caso : undefined
  if (caso !== a.caso) return `la confirmación fue para el caso ${a.caso}, no para ${String(caso)}`
  if (a.usada) return "esa confirmación ya se usó; cada envío necesita una confirmación nueva"
  return null
}
