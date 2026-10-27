/**
 * Contexto que recibe cada herramienta (contrato de la sección 6.2 del PRD).
 * `fechaReferencia` es opcional: permite evaluar vigencias con una fecha fija (pruebas, demo).
 */
export type ContextoHerramienta = {
  /** Raíz del proyecto. Todas las rutas se resuelven desde aquí. */
  directory: string
  sessionId: string
  /** Fecha AAAA-MM-DD contra la que se evalúan vigencias. Si falta: FECHA_REFERENCIA o la fecha del sistema. */
  fechaReferencia?: string
}
