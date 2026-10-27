import { z } from "zod"
import reglasCrudas from "../knowledge/reglas.json"

/** Esquemas de los fixtures: detectan plantillas corruptas con un mensaje claro. */

export const esquemaFormato = z.enum(["xlsx", "pdf", "portal"])
export type Formato = z.infer<typeof esquemaFormato>

export const esquemaSolicitud = z.object({
  id: z.string(),
  de: z.string(),
  para: z.string().optional(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string().length(2),
  cliente: z.string(),
  formato: z.string(),
  cuerpo: z.string(),
  adjuntos: z.array(z.string()).default([]),
})
export type Solicitud = z.infer<typeof esquemaSolicitud>

const PATRON_CELDA = /^[A-Z]{1,3}[1-9]\d*$/

export const esquemaPlantillaCeldas = z
  .array(
    z.object({
      hoja: z.string().min(1).max(31),
      celda_etiqueta: z.string().regex(PATRON_CELDA, "celda inválida"),
      etiqueta: z.string().min(1),
      celda_valor: z.string().regex(PATRON_CELDA, "celda inválida"),
    }),
  )
  .min(1, "la plantilla no tiene campos")
export type PlantillaCeldas = z.infer<typeof esquemaPlantillaCeldas>

export const esquemaPlantillaCampos = z
  .array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean().default(false) }))
  .min(1, "la plantilla no tiene campos")
export type PlantillaCampos = z.infer<typeof esquemaPlantillaCampos>

export const esquemaSoportesExigidos = z.array(z.string().min(1))

export const esquemaIndiceSoportes = z.array(
  z.object({
    tipo: z.string(),
    archivo: z.string(),
    vigencia_hasta: z.string().nullable(),
    pais_emisor: z.string(),
    descripcion: z.string().optional(),
  }),
)
export type EntradaSoporte = z.infer<typeof esquemaIndiceSoportes>[number]

export const esquemaGlosario = z.record(z.string(), z.string())
export type Glosario = z.infer<typeof esquemaGlosario>

export const esquemaMaestro = z.record(z.string(), z.unknown())
export type Maestro = z.infer<typeof esquemaMaestro>

const esquemaReglas = z.object({
  pais_maestro: z.string(),
  identificador_tributario_por_pais: z.record(z.string(), z.string()),
  clave_identificador_tributario: z.string(),
  etiquetas_identificador_tributario: z.array(z.string()),
  etiquetas_ambiguas: z.array(z.string()),
  prefijo_claves_bancarias: z.string(),
  claves_sensibles: z.array(z.string()),
  umbral_confianza: z.number(),
  umbral_sugerencia: z.number(),
  dias_alerta_vencimiento: z.number().int(),
  nombres_soportes: z.record(z.string(), z.string()),
  nombres_paises: z.record(z.string(), z.string()),
})
export type Reglas = z.infer<typeof esquemaReglas>

/** Reglas de negocio (src/knowledge/reglas.json): cambiarlas no toca código. */
export const reglas: Reglas = esquemaReglas.parse(reglasCrudas)

export function nombreSoporte(tipo: string): string {
  return reglas.nombres_soportes[tipo] ?? tipo
}

export function nombrePais(codigo: string): string {
  return reglas.nombres_paises[codigo] ?? codigo
}
