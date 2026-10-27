import { join } from "node:path"
import type { ContextoHerramienta } from "./contexto"
import { existe, leerJson } from "./archivos"
import { esquemaIndiceSoportes, nombreSoporte, reglas, type EntradaSoporte } from "./esquemas"
import { diasEntre } from "./fechas"
import { exito, type Resultado } from "./resultado"
import { rutasDe } from "./rutas"

export type EstadoSoporte = "presente" | "por_vencer" | "vencido" | "ausente"

export type SoporteEvaluado = {
  tipo: string
  nombre: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  dias_restantes: number | null
  pais_emisor: string | null
  detalle: string
}

export function bloquea(soporte: SoporteEvaluado): boolean {
  return soporte.estado === "vencido" || soporte.estado === "ausente"
}

/** Regla RN3: vencido o ausente bloquea; por vencer solo alerta. Función pura. */
export function evaluarSoportes(
  exigidos: string[],
  indice: EntradaSoporte[],
  fecha: string,
  archivosExistentes: ReadonlySet<string>,
): SoporteEvaluado[] {
  return exigidos.map((tipo) => {
    const entrada = indice.find((e) => e.tipo === tipo)
    const base = { tipo, nombre: nombreSoporte(tipo) }
    if (!entrada) {
      return { ...base, estado: "ausente", archivo: null, vigencia_hasta: null, dias_restantes: null, pais_emisor: null, detalle: "No existe en el repositorio de soportes: hay que tramitarlo." }
    }
    const comun = { ...base, archivo: entrada.archivo, vigencia_hasta: entrada.vigencia_hasta, pais_emisor: entrada.pais_emisor }
    if (!archivosExistentes.has(entrada.archivo)) {
      return { ...comun, estado: "ausente", dias_restantes: null, detalle: `Está en el índice, pero el archivo ${entrada.archivo} no se encuentra.` }
    }
    if (entrada.vigencia_hasta === null) {
      return { ...comun, estado: "presente", dias_restantes: null, detalle: "Sin fecha de vencimiento." }
    }
    const dias = diasEntre(fecha, entrada.vigencia_hasta)
    if (dias < 0) {
      return { ...comun, estado: "vencido", dias_restantes: dias, detalle: `Venció el ${entrada.vigencia_hasta} (hace ${-dias} días): hay que actualizarlo.` }
    }
    if (dias <= reglas.dias_alerta_vencimiento) {
      return { ...comun, estado: "por_vencer", dias_restantes: dias, detalle: `Vigente hasta ${entrada.vigencia_hasta}: vence en ${dias} días.` }
    }
    return { ...comun, estado: "presente", dias_restantes: dias, detalle: `Vigente hasta ${entrada.vigencia_hasta}.` }
  })
}

export type IndiceCargado = { indice: EntradaSoporte[]; archivos: Set<string>; advertencia?: string }

/** Lee el índice y verifica qué archivos existen. Si el índice falla, todo queda "ausente". */
export async function cargarIndiceSoportes(ctx: ContextoHerramienta): Promise<Resultado<IndiceCargado>> {
  const rutas = rutasDe(ctx)
  const leido = await leerJson(rutas.indiceSoportes, esquemaIndiceSoportes, "El índice de soportes")
  if (!leido.ok) return exito({ indice: [], archivos: new Set(), advertencia: leido.error })
  const archivos = new Set<string>()
  for (const entrada of leido.data) {
    const seguro = !/[\\/]|\.\./.test(entrada.archivo)
    if (seguro && (await existe(join(rutas.soportes, entrada.archivo)))) archivos.add(entrada.archivo)
  }
  return exito({ indice: leido.data, archivos })
}
