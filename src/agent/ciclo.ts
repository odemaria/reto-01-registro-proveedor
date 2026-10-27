import { listarCasos } from "../dominio/caso"
import type { ContextoHerramienta } from "../dominio/contexto"
import { ErrorProveedor, type DefinicionHerramienta, type LlamadaHerramienta, type ProveedorLLM, type RespuestaLLM, type ResultadoHerramienta } from "../llm/adapter"
import { REQUIEREN_CONFIRMACION, type HerramientaRegistrada } from "../tools/registro"
import { accionPendienteDe, evaluarConfirmacion, pideConfirmacion, rechazoDeLlamada, type AccionPendiente, type EvaluacionConfirmacion } from "./confirmacion"
import type { LlamadaVisible, Sesion } from "./sesiones"

export type DependenciasCiclo = {
  proveedor: ProveedorLLM
  herramientas: Map<string, HerramientaRegistrada>
  sistema: string
  directorio: string
  fechaReferencia?: string
  maxIteraciones: number
  maxTokensSesion: number
  timeoutMs: number
}

export type RespuestaTurno = {
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  /** Acción concreta que el usuario debe confirmar (ej. simular el envío del caso X). */
  pendingAction: AccionPendiente | null
  error?: boolean
}

const MAX_RESULTADO_VISIBLE = 6000
const HERRAMIENTA_PAQUETE = "proveedor_armar_paquete"

function resumenDe(contenido: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(contenido) as { ok?: boolean; error?: string; data?: Record<string, unknown> }
    if (r.ok === false) return { ok: false, resumen: r.error ?? "error" }
    const d = r.data ?? {}
    const partes: string[] = []
    if (typeof d.ruta === "string") partes.push(d.ruta)
    if (Array.isArray(d.llenos)) partes.push(`${d.llenos.length} llenos`)
    if (Array.isArray(d.requiere_confirmacion)) partes.push(`${d.requiere_confirmacion.length} por confirmar`)
    if (Array.isArray(d.faltantes)) partes.push(`${d.faltantes.length} faltantes`)
    if (typeof d.listo_para_firma === "boolean") partes.push(d.listo_para_firma ? "listo para firma" : "NO listo para firma")
    if (typeof d.formato === "string" && typeof d.ruta !== "string") partes.push(`formato ${d.formato}`)
    if (Array.isArray(d.campos) && !Array.isArray(d.llenos)) partes.push(`${d.campos.length} campos`)
    return { ok: true, resumen: partes.join(" · ") || "ok" }
  } catch {
    return { ok: false, resumen: "respuesta ilegible" }
  }
}

/** Compuerta RN4: una herramienta con efecto externo solo corre con una autorización vigente para ESA acción y ESE caso. */
function revisarCompuerta(llamada: LlamadaHerramienta, evaluacion: EvaluacionConfirmacion): string | null {
  if (!REQUIEREN_CONFIRMACION.has(llamada.nombre)) return null
  const rechazo = rechazoDeLlamada(llamada.nombre, llamada.argumentos, evaluacion)
  if (rechazo) return `requiere confirmación explícita: ${rechazo}. No reintentes; pregunta al usuario y termina el turno.`
  if (evaluacion.autorizacion) evaluacion.autorizacion.usada = true
  return null
}

async function ejecutarLlamada(
  llamada: LlamadaHerramienta,
  deps: DependenciasCiclo,
  ctx: ContextoHerramienta,
  evaluacion: EvaluacionConfirmacion,
): Promise<{ resultado: ResultadoHerramienta; visible: LlamadaVisible }> {
  const herramienta = deps.herramientas.get(llamada.nombre)
  const rechazo = herramienta ? revisarCompuerta(llamada, evaluacion) : null
  let contenido: string
  if (!herramienta) contenido = JSON.stringify({ ok: false, error: `La herramienta "${llamada.nombre}" no existe.` })
  else if (rechazo) contenido = JSON.stringify({ ok: false, error: rechazo })
  else contenido = await herramienta.ejecutar(llamada.argumentos, ctx)

  const { ok, resumen } = resumenDe(contenido)
  return {
    resultado: { id: llamada.id, nombre: llamada.nombre, contenido, esError: !ok },
    visible: {
      nombre: llamada.nombre,
      argumentos: llamada.argumentos,
      ok,
      resumen: rechazo ? `bloqueada: ${rechazo.split(". No reintentes")[0]}` : resumen,
      resultado: contenido.length > MAX_RESULTADO_VISIBLE ? `${contenido.slice(0, MAX_RESULTADO_VISIBLE)}…` : contenido,
      bloqueadaPorPolitica: rechazo ? true : undefined,
    },
  }
}

function respuestaPorTope(visibles: LlamadaVisible[], tope: number): string {
  const hechas = visibles.filter((v) => v.ok).map((v) => `- ${v.nombre}: ${v.resumen}`)
  const fallidas = visibles.filter((v) => !v.ok).map((v) => `- ${v.nombre}: ${v.resumen}`)
  return [
    `Alcancé el tope de ${tope} pasos en este turno, así que me detengo aquí.`,
    "",
    "**Lo que quedó hecho:**",
    ...(hechas.length ? hechas : ["- Nada todavía."]),
    ...(fallidas.length ? ["", "**Lo que falló o falta:**", ...fallidas] : []),
    "",
    "Escribe \"continúa\" para seguir desde aquí.",
  ].join("\n")
}

/** Timeout duro: aunque el proveedor ignore la señal de cancelación, el turno no se queda esperando. */
async function consultar(deps: DependenciasCiclo, sesion: Sesion, definiciones: DefinicionHerramienta[]): Promise<RespuestaLLM> {
  const controlador = new AbortController()
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(() => {
      controlador.abort()
      const estado = deps.proveedor.estado?.()
      console.log(`[llm] timeout de ${deps.timeoutMs} ms · ${estado ?? "sin estado"}`)
      rechazar(new ErrorProveedor(`El modelo no respondió en ${Math.round(deps.timeoutMs / 1000)} s${estado ? ` (${estado})` : ""}. Intenta de nuevo.`, true))
    }, deps.timeoutMs)
  })
  try {
    return await Promise.race([deps.proveedor.enviar(sesion.mensajes, definiciones, { sistema: deps.sistema, signal: controlador.signal }), limite])
  } finally {
    clearTimeout(temporizador)
  }
}

function casoArmado(visibles: LlamadaVisible[]): string | null {
  const ultimo = [...visibles].reverse().find((v) => v.nombre === HERRAMIENTA_PAQUETE && v.ok)
  const caso = (ultimo?.argumentos as { caso?: unknown } | undefined)?.caso
  return typeof caso === "string" ? caso : null
}

function cerrarTurno(sesion: Sesion, texto: string, visibles: LlamadaVisible[], casos: string[]): RespuestaTurno {
  const needsConfirmation = pideConfirmacion(texto)
  const pendingAction = needsConfirmation ? accionPendienteDe(texto, casos, sesion.ultimoCasoArmado) : null
  sesion.accionPendiente = pendingAction
  return { reply: texto, toolCalls: visibles, needsConfirmation, pendingAction }
}

/** Si el modelo falla después de ejecutar herramientas, el usuario igual sabe qué quedó hecho (sin inventar nada). */
function resumenDeLoHecho(visibles: LlamadaVisible[]): string {
  const hechas = visibles.filter((v) => v.ok).map((v) => `- ${v.nombre}: ${v.resumen}`)
  return hechas.length > 0 ? `\n\nAntes del error alcancé a completar:\n${hechas.join("\n")}` : ""
}

function fallar(reply: string, visibles: LlamadaVisible[]): RespuestaTurno {
  return { reply, toolCalls: visibles, needsConfirmation: false, pendingAction: null, error: true }
}

/**
 * Un turno del agente: prompt → modelo → herramientas → … → respuesta.
 * Tope de iteraciones (CA1), confirmación humana ligada a acción y caso (CA3/RN4),
 * errores en lenguaje claro sin matar la sesión (CA5).
 */
export async function ejecutarTurno(sesion: Sesion, mensajeUsuario: string, deps: DependenciasCiclo): Promise<RespuestaTurno> {
  const ctx: ContextoHerramienta = { directory: deps.directorio, sessionId: sesion.id, fechaReferencia: deps.fechaReferencia }
  const casos = await listarCasos(ctx)
  // La autorización se calcula UNA vez, con la acción que quedó pendiente del turno anterior, y vence con este turno.
  const evaluacion = evaluarConfirmacion(sesion.accionPendiente, mensajeUsuario, casos)
  sesion.accionPendiente = null
  sesion.mensajes.push({ rol: "usuario", texto: mensajeUsuario })

  const definiciones = [...deps.herramientas.values()].map(({ nombre, descripcion, esquema }) => ({ nombre, descripcion, esquema }))
  const visibles: LlamadaVisible[] = []

  for (let iteracion = 0; iteracion < deps.maxIteraciones; iteracion++) {
    if (sesion.tokensUsados >= deps.maxTokensSesion) {
      return fallar(`Esta sesión alcanzó su tope de uso (${deps.maxTokensSesion.toLocaleString("es-CO")} tokens). Abre una sesión nueva para continuar.`, visibles)
    }
    let respuesta: RespuestaLLM
    try {
      respuesta = await consultar(deps, sesion, definiciones)
    } catch (error) {
      const mensaje = error instanceof ErrorProveedor ? error.message : "Error inesperado al consultar el modelo."
      return fallar(`⚠️ ${mensaje} La sesión sigue activa: puedes reintentar.${resumenDeLoHecho(visibles)}`, visibles)
    }
    sesion.tokensUsados += respuesta.uso.entrada + respuesta.uso.salida
    sesion.mensajes.push({ rol: "asistente", texto: respuesta.texto, llamadas: respuesta.llamadas, crudo: respuesta.crudo })

    if (respuesta.fin === "pausa") continue
    if (respuesta.llamadas.length === 0) {
      if (respuesta.fin === "rechazo") return fallar("El modelo no pudo responder a esta solicitud. Reformúlala, por favor.", visibles)
      const texto = respuesta.texto || (respuesta.fin === "limite_tokens" ? "La respuesta se cortó por longitud. Pide un resumen más corto." : "(sin respuesta)")
      return cerrarTurno(sesion, texto, visibles, casos)
    }

    const resultados: ResultadoHerramienta[] = []
    for (const llamada of respuesta.llamadas) {
      const { resultado, visible } = await ejecutarLlamada(llamada, deps, ctx, evaluacion)
      resultados.push(resultado)
      visibles.push(visible)
    }
    sesion.ultimoCasoArmado = casoArmado(visibles) ?? sesion.ultimoCasoArmado
    sesion.mensajes.push({ rol: "resultados", resultados })
  }

  return { reply: respuestaPorTope(visibles, deps.maxIteraciones), toolCalls: visibles, needsConfirmation: false, pendingAction: null }
}
