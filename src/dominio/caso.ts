import { readdir } from "node:fs/promises"
import { join } from "node:path"
import type { ContextoHerramienta } from "./contexto"
import { existe, leerJson } from "./archivos"
import {
  esquemaFormato,
  esquemaPlantillaCampos,
  esquemaPlantillaCeldas,
  esquemaSoportesExigidos,
  esquemaSolicitud,
  type Formato,
  type PlantillaCampos,
  type PlantillaCeldas,
  type Solicitud,
} from "./esquemas"
import { exito, fallo, type Resultado } from "./resultado"
import { carpetaCaso, rutasDe, validarNombreCaso } from "./rutas"

export type Plantilla =
  | { tipo: "celdas"; archivo: "plantilla-celdas.json"; celdas: PlantillaCeldas }
  | { tipo: "campos"; archivo: "plantilla-campos.json"; campos: PlantillaCampos }

export type CampoSolicitado = {
  etiqueta: string
  obligatorio: boolean | null
  /** "Hoja!C3" para Excel; posición en el orden para PDF/portal. */
  ubicacion: string
}

export type Caso = {
  caso: string
  solicitud: Solicitud
  formato: Formato | null
  plantilla: Plantilla | null
  campos: CampoSolicitado[]
  soportesExigidos: string[]
  advertencias: string[]
}

export async function listarCasos(ctx: ContextoHerramienta): Promise<string[]> {
  try {
    const entradas = await readdir(rutasDe(ctx).casos, { withFileTypes: true })
    return entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  } catch {
    return []
  }
}

function camposDePlantilla(plantilla: Plantilla): CampoSolicitado[] {
  if (plantilla.tipo === "celdas") {
    return plantilla.celdas.map((c) => ({ etiqueta: c.etiqueta, obligatorio: null, ubicacion: `${c.hoja}!${c.celda_valor}` }))
  }
  return plantilla.campos.map((c, i) => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio, ubicacion: `#${i + 1}` }))
}

async function leerPlantilla(carpeta: string, formato: Formato | null, advertencias: string[]): Promise<Plantilla | null> {
  const rutaCeldas = join(carpeta, "plantilla-celdas.json")
  const rutaCampos = join(carpeta, "plantilla-campos.json")
  const usarCeldas = formato === "xlsx" || (formato === null && (await existe(rutaCeldas)))

  if (usarCeldas) {
    const r = await leerJson(rutaCeldas, esquemaPlantillaCeldas, "La plantilla Excel (plantilla-celdas.json)")
    if (r.ok) return { tipo: "celdas", archivo: "plantilla-celdas.json", celdas: r.data }
    advertencias.push(r.error)
    return null
  }
  if (formato === "portal" && !(await existe(rutaCampos))) {
    advertencias.push("El caso es de portal web y no trae lista de campos: no hay valores que preparar.")
    return null
  }
  const r = await leerJson(rutaCampos, esquemaPlantillaCampos, "La plantilla de campos (plantilla-campos.json)")
  if (r.ok) return { tipo: "campos", archivo: "plantilla-campos.json", campos: r.data }
  advertencias.push(r.error)
  return null
}

/**
 * Lee todo lo que define un caso. Solo falla si el caso no existe o la solicitud es ilegible;
 * una plantilla corrupta queda como advertencia para poder seguir con lo demás (HU-5).
 */
export async function leerCaso(ctx: ContextoHerramienta, casoCrudo: string): Promise<Resultado<Caso>> {
  const nombre = validarNombreCaso(casoCrudo)
  if (!nombre.ok) return nombre
  const caso = nombre.data
  const carpeta = carpetaCaso(ctx, caso)

  if (!(await existe(carpeta))) {
    const disponibles = await listarCasos(ctx)
    return fallo(`El caso "${caso}" no existe. Casos disponibles: ${disponibles.join(", ") || "ninguno"}.`)
  }

  const solicitud = await leerJson(join(carpeta, "solicitud.json"), esquemaSolicitud, "La solicitud (solicitud.json)")
  if (!solicitud.ok) return solicitud

  const advertencias: string[] = []
  const formatoLeido = esquemaFormato.safeParse(solicitud.data.formato.toLowerCase())
  const formato = formatoLeido.success ? formatoLeido.data : null
  if (!formato) advertencias.push(`Formato "${solicitud.data.formato}" no soportado: se esperaba xlsx, pdf o portal.`)

  const plantilla = await leerPlantilla(carpeta, formato, advertencias)

  const exigidos = await leerJson(join(carpeta, "soportes-exigidos.json"), esquemaSoportesExigidos, "La lista de soportes exigidos")
  if (!exigidos.ok) advertencias.push(exigidos.error)

  return exito({
    caso,
    solicitud: solicitud.data,
    formato,
    plantilla,
    campos: plantilla ? camposDePlantilla(plantilla) : [],
    soportesExigidos: exigidos.ok ? exigidos.data : [],
    advertencias,
  })
}
