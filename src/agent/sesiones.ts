import { randomUUID } from "node:crypto"
import type { Mensaje } from "../llm/adapter"
import type { AccionPendiente } from "./confirmacion"

export type LlamadaVisible = {
  nombre: string
  argumentos: unknown
  ok: boolean
  resumen: string
  /** Resultado completo (JSON) recortado para no inflar la respuesta HTTP. */
  resultado: string
  bloqueadaPorPolitica?: boolean
}

export type EntradaHistorial =
  | { rol: "usuario"; texto: string; ts: string }
  | { rol: "agente"; texto: string; ts: string; toolCalls: LlamadaVisible[]; needsConfirmation: boolean; pendingAction?: AccionPendiente | null; error?: boolean }

export type Sesion = {
  id: string
  creada: string
  /** Conversación tal como la ve el modelo (solo crece: nunca se edita). */
  mensajes: Mensaje[]
  /** Conversación tal como la ve la persona en el chat. */
  historial: EntradaHistorial[]
  tokensUsados: number
  /** Acción que el agente pidió confirmar al cerrar su último turno (null si no pidió nada). */
  accionPendiente: AccionPendiente | null
  /** Último caso con paquete armado: permite saber a qué caso se refiere "¿confirmas el envío?". */
  ultimoCasoArmado: string | null
  ocupada: boolean
  ultimoUso: number
}

const PATRON_ID = /^[A-Za-z0-9_-]{8,64}$/

/** Sesiones en memoria con tope (se descarta la menos usada). Suficiente para el reto (3.2). */
export class AlmacenSesiones {
  private readonly sesiones = new Map<string, Sesion>()

  constructor(private readonly maximo: number) {}

  esIdValido(id: string): boolean {
    return PATRON_ID.test(id)
  }

  obtener(id: string): Sesion | undefined {
    return this.sesiones.get(id)
  }

  obtenerOCrear(id?: string): Sesion {
    const existente = id ? this.sesiones.get(id) : undefined
    if (existente) {
      existente.ultimoUso = Date.now()
      return existente
    }
    this.liberarEspacio()
    const sesion: Sesion = {
      id: id && this.esIdValido(id) ? id : randomUUID(),
      creada: new Date().toISOString(),
      mensajes: [],
      historial: [],
      tokensUsados: 0,
      accionPendiente: null,
      ultimoCasoArmado: null,
      ocupada: false,
      ultimoUso: Date.now(),
    }
    this.sesiones.set(sesion.id, sesion)
    return sesion
  }

  private liberarEspacio(): void {
    if (this.sesiones.size < this.maximo) return
    const libres = [...this.sesiones.values()].filter((s) => !s.ocupada).sort((a, b) => a.ultimoUso - b.ultimoUso)
    const victima = libres[0]
    if (victima) this.sesiones.delete(victima.id)
  }
}
