import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { join } from "node:path"
import type { Caso } from "./caso"
import { escribirTexto } from "./archivos"
import type { Maestro, PlantillaCampos, PlantillaCeldas } from "./esquemas"
import { nombrePais } from "./esquemas"
import { resolverClave } from "./maestro"
import { valorParaFormulario, type Mapeo } from "./mapeo"
import { celdaMd } from "./texto"

export const ARCHIVO_FORMULARIO = { xlsx: "formulario.xlsx", pdf: "formulario.pdf", portal: "valores-portal.md" } as const

function fechaFija(fecha: string): Date {
  return new Date(`${fecha}T12:00:00Z`)
}

function comoTexto(valor: string | number | boolean): string {
  if (typeof valor === "boolean") return valor ? "Sí" : "No"
  return String(valor)
}

// ───────────────────────── Excel ─────────────────────────

/** Escribe cada etiqueta y su valor en la hoja y celda exactas de plantilla-celdas.json (HU-3 P0). */
export async function generarXlsx(celdas: PlantillaCeldas, mapeo: Mapeo, destino: string, fecha: string): Promise<string> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Agente Registro Proveedor"
  libro.lastModifiedBy = "Agente Registro Proveedor"
  libro.created = fechaFija(fecha)
  libro.modified = fechaFija(fecha)

  for (const campo of celdas) {
    const hoja = libro.getWorksheet(campo.hoja) ?? libro.addWorksheet(campo.hoja)
    const celdaEtiqueta = hoja.getCell(campo.celda_etiqueta)
    celdaEtiqueta.value = campo.etiqueta
    celdaEtiqueta.font = { bold: true }

    const encontrado = valorParaFormulario(mapeo, campo.etiqueta)
    const celdaValor = hoja.getCell(campo.celda_valor)
    if (encontrado) {
      celdaValor.value = typeof encontrado.valor === "boolean" ? comoTexto(encontrado.valor) : encontrado.valor
      if (encontrado.nota) celdaValor.note = encontrado.nota
    }
    hoja.getColumn(celdaEtiqueta.col).width = 34
    hoja.getColumn(celdaValor.col).width = 48
  }

  const ruta = join(destino, ARCHIVO_FORMULARIO.xlsx)
  const buffer = await libro.xlsx.writeBuffer()
  await escribirTexto(ruta, new Uint8Array(buffer))
  return ruta
}

// ───────────────────────── PDF ─────────────────────────

const A4 = { ancho: 595.28, alto: 841.89 }
const MARGEN = 50
const COLUMNA_VALOR = 250

/** Helvetica estándar solo codifica WinAnsi: se reemplaza lo que no se puede dibujar. */
function seguroWinAnsi(texto: string): string {
  return texto.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•€]/g, "?")
}

function partirLineas(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of seguroWinAnsi(texto).split(/\s+/)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(prueba, tamano) <= ancho || actual === "") actual = prueba
    else {
      lineas.push(actual)
      actual = palabra
    }
  }
  if (actual) lineas.push(actual)
  return lineas.length > 0 ? lineas : [""]
}

type Lienzo = { doc: PDFDocument; pagina: PDFPage; y: number; normal: PDFFont; negrita: PDFFont }

function asegurarEspacio(l: Lienzo, alto: number): void {
  if (l.y - alto > MARGEN + 20) return
  l.pagina = l.doc.addPage([A4.ancho, A4.alto])
  l.y = A4.alto - MARGEN
}

function texto(l: Lienzo, contenido: string, x: number, opciones: { tamano?: number; negrita?: boolean; gris?: boolean } = {}): void {
  l.pagina.drawText(seguroWinAnsi(contenido), {
    x,
    y: l.y,
    size: opciones.tamano ?? 10,
    font: opciones.negrita ? l.negrita : l.normal,
    color: opciones.gris ? rgb(0.4, 0.4, 0.4) : rgb(0, 0, 0),
  })
}

/** PDF generado con todos los campos (etiqueta y valor) en el orden de plantilla-campos.json (HU-3 P1). */
export async function generarPdf(campos: PlantillaCampos, mapeo: Mapeo, caso: Caso, maestro: Maestro, destino: string, fecha: string): Promise<string> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Formulario de registro de proveedor - ${caso.solicitud.cliente}`)
  doc.setCreator("Agente Registro Proveedor")
  doc.setProducer("reto-01")
  doc.setCreationDate(fechaFija(fecha))
  doc.setModificationDate(fechaFija(fecha))

  const l: Lienzo = {
    doc,
    pagina: doc.addPage([A4.ancho, A4.alto]),
    y: A4.alto - MARGEN,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  texto(l, "Formulario de registro de proveedor", MARGEN, { tamano: 16, negrita: true })
  l.y -= 22
  const adjunto = caso.solicitud.adjuntos[0] ?? "formulario del cliente"
  texto(l, `Cliente: ${caso.solicitud.cliente} (${nombrePais(caso.solicitud.pais)}) · Documento: ${adjunto}`, MARGEN, { tamano: 9, gris: true })
  l.y -= 14
  texto(l, `Fecha de diligenciamiento: ${fecha}`, MARGEN, { tamano: 9, gris: true })
  l.y -= 24

  const anchoValor = A4.ancho - MARGEN - COLUMNA_VALOR
  for (const campo of campos) {
    const encontrado = valorParaFormulario(mapeo, campo.etiqueta)
    const valor = encontrado ? comoTexto(encontrado.valor) + (encontrado.nota ? ` (${encontrado.nota})` : "") : ""
    const lineasEtiqueta = partirLineas(`${campo.etiqueta}${campo.obligatorio ? " *" : ""}`, l.negrita, 10, COLUMNA_VALOR - MARGEN - 10)
    const lineasValor = partirLineas(valor, l.normal, 10, anchoValor)
    const filas = Math.max(lineasEtiqueta.length, lineasValor.length)
    asegurarEspacio(l, filas * 13 + 12)

    const yInicio = l.y
    lineasEtiqueta.forEach((linea, i) => {
      l.y = yInicio - i * 13
      texto(l, linea, MARGEN, { negrita: true })
    })
    lineasValor.forEach((linea, i) => {
      l.y = yInicio - i * 13
      texto(l, linea, COLUMNA_VALOR)
    })
    l.y = yInicio - filas * 13 + 4
    l.pagina.drawLine({ start: { x: COLUMNA_VALOR, y: l.y }, end: { x: A4.ancho - MARGEN, y: l.y }, thickness: 0.5, color: rgb(0.75, 0.75, 0.75) })
    l.y -= 14
  }

  l.y -= 6
  texto(l, "Los campos marcados con * son obligatorios.", MARGEN, { tamano: 8, gris: true })

  asegurarEspacio(l, 90)
  l.y -= 60
  l.pagina.drawLine({ start: { x: MARGEN, y: l.y }, end: { x: MARGEN + 220, y: l.y }, thickness: 0.8, color: rgb(0, 0, 0) })
  l.y -= 12
  const representante = resolverClave(maestro, "representante_legal.nombre")
  const cargo = resolverClave(maestro, "representante_legal.cargo")
  texto(l, `Firma del representante legal${representante ? `: ${comoTexto(representante)}` : ""}`, MARGEN, { tamano: 9 })
  if (cargo) {
    l.y -= 12
    texto(l, comoTexto(cargo), MARGEN, { tamano: 9, gris: true })
  }

  const ruta = join(destino, ARCHIVO_FORMULARIO.pdf)
  await escribirTexto(ruta, await doc.save({ useObjectStreams: false }))
  return ruta
}

// ───────────────────────── Portal (P2: no soportado) ─────────────────────────

/** Valores listos para copiar en el portal. Credenciales y "Enviar" siempre los hace un humano. */
export async function generarValoresPortal(campos: PlantillaCampos, mapeo: Mapeo, caso: Caso, destino: string, fecha: string): Promise<string> {
  const filas = campos.map((campo) => {
    const encontrado = valorParaFormulario(mapeo, campo.etiqueta)
    const porConfirmar = mapeo.requiere_confirmacion.some((c) => c.etiqueta === campo.etiqueta)
    const estado = encontrado ? (porConfirmar ? "por confirmar" : "lleno") : "FALTANTE"
    const valor = encontrado ? comoTexto(encontrado.valor) : ""
    return `| ${celdaMd(campo.etiqueta)}${campo.obligatorio ? " *" : ""} | ${celdaMd(valor)} | ${estado} |`
  })

  const urls = caso.solicitud.cuerpo.match(/https?:\/\/[^\s)]+/g) ?? []
  const contenido = [
    `# Valores para el portal — ${caso.solicitud.cliente}`,
    "",
    `> **Formato no soportado para llenado automático.** El agente no ingresa a portales web.`,
    `> Una persona inicia sesión con las credenciales que recibió el representante legal, copia estos valores y hace clic en "Enviar".`,
    "",
    `- Caso: \`${caso.caso}\``,
    `- Portal indicado en el correo: ${urls[0] ?? "no indicado"}`,
    `- Fecha de preparación: ${fecha}`,
    "",
    "| Campo | Valor | Estado |",
    "|---|---|---|",
    ...filas,
    "",
    "Los campos marcados con * son obligatorios. Los campos \"por confirmar\" deben revisarse antes de cargarlos.",
    "",
  ].join("\n")

  const ruta = join(destino, ARCHIVO_FORMULARIO.portal)
  await escribirTexto(ruta, contenido)
  return ruta
}
