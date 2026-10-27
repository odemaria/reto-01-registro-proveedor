import type { Caso } from "./caso"
import { nombrePais, reglas, type Maestro } from "./esquemas"
import { clavesHoja, resolverClave } from "./maestro"
import type { Mapeo } from "./mapeo"
import type { SoporteEvaluado } from "./soportes"
import { celdaMd } from "./texto"

const ETIQUETA_ESTADO: Record<SoporteEvaluado["estado"], string> = {
  presente: "Presente",
  por_vencer: "Por vencer",
  vencido: "VENCIDO",
  ausente: "AUSENTE",
}

function texto(maestro: Maestro, clave: string): string {
  const valor = resolverClave(maestro, clave)
  return valor === undefined ? "" : String(valor)
}

/** Reporte de faltantes (O2): todo lo que no se llenó, con su motivo. */
export function reporteFaltantes(caso: Caso, mapeo: Mapeo, fecha: string): string {
  const lineas = [
    `# Reporte de faltantes — ${caso.caso}`,
    "",
    `Cliente: ${caso.solicitud.cliente} (${nombrePais(caso.solicitud.pais)}) · Fecha: ${fecha}`,
    "",
    `Llenos: ${mapeo.llenos.length} · Requieren confirmación: ${mapeo.requiere_confirmacion.length} · Faltantes: ${mapeo.faltantes.length}`,
    "",
    "## Faltantes (no existen en el maestro; no se inventan)",
    "",
  ]
  if (mapeo.faltantes.length === 0) lineas.push("Ninguno.")
  for (const f of mapeo.faltantes) lineas.push(`- **${f.etiqueta}**${f.obligatorio ? " (obligatorio)" : ""}: ${f.motivo}`)
  lineas.push("", "## Requieren confirmación", "")
  if (mapeo.requiere_confirmacion.length === 0) lineas.push("Ninguno.")
  for (const c of mapeo.requiere_confirmacion) {
    lineas.push(`- **${c.etiqueta}**: ${c.motivo}${c.propuesta ? ` Propuesta: ${c.propuesta}.` : ""}${c.se_escribe ? " (Se escribió en el formulario.)" : " (No se escribió hasta confirmar.)"}`)
  }
  lineas.push("")
  return lineas.join("\n")
}

export type DatosChecklist = {
  caso: Caso
  mapeo: Mapeo
  soportes: SoporteEvaluado[]
  bloqueantes: string[]
  observaciones: string[]
  listo: boolean
  fecha: string
  formulario: string | null
}

function nombres(soportes: SoporteEvaluado[], estado: SoporteEvaluado["estado"]): string {
  const lista = soportes.filter((s) => s.estado === estado).map((s) => s.nombre)
  return lista.length > 0 ? lista.join("; ") : "ninguno"
}

export function checklistMd(d: DatosChecklist): string {
  const { caso, mapeo } = d
  const lineas = [
    `# Checklist del paquete — ${caso.caso}`,
    "",
    `- Cliente: ${caso.solicitud.cliente} (${nombrePais(caso.solicitud.pais)})`,
    `- Formato: ${caso.formato ?? "desconocido"} · Formulario: ${d.formulario ?? "no generado"}`,
    `- Fecha de referencia para vigencias: ${d.fecha}`,
    `- **Estado: ${d.listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"}**`,
    "",
    "## Resumen",
    "",
    `- Listo para firma: **${d.listo ? "sí" : "no"}**`,
    `- Formulario completo: **${mapeo.faltantes.length === 0 && mapeo.requiere_confirmacion.length === 0 ? "sí" : "no"}** (${mapeo.faltantes.length} faltantes, ${mapeo.requiere_confirmacion.length} por confirmar; los faltantes no bloquean la firma pero deben completarse)`,
    `- Soportes presentes: ${nombres(d.soportes, "presente")}`,
    `- Soportes por vencer: ${nombres(d.soportes, "por_vencer")}`,
    `- Soportes ausentes: ${nombres(d.soportes, "ausente")}`,
    `- Soportes vencidos: ${nombres(d.soportes, "vencido")}`,
    "",
    "## Bloqueantes",
    "",
    ...(d.bloqueantes.length > 0 ? d.bloqueantes.map((b) => `- [ ] ${b}`) : ["Ninguno."]),
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Archivo | Vigencia | Estado | Detalle |",
    "|---|---|---|---|---|",
    ...d.soportes.map((s) => `| ${celdaMd(s.nombre)} | ${s.archivo ?? "—"} | ${s.vigencia_hasta ?? "no vence"} | ${ETIQUETA_ESTADO[s.estado]} | ${celdaMd(s.detalle)} |`),
    "",
    "## Campos del formulario",
    "",
    `Llenos: ${mapeo.llenos.length} · Requieren confirmación: ${mapeo.requiere_confirmacion.length} · Faltantes: ${mapeo.faltantes.length}`,
    "",
  ]
  if (mapeo.requiere_confirmacion.length > 0) {
    lineas.push("### Requieren confirmación", "")
    for (const c of mapeo.requiere_confirmacion) lineas.push(`- [ ] **${c.etiqueta}**: ${c.motivo}`)
    lineas.push("")
  }
  if (mapeo.faltantes.length > 0) {
    lineas.push("### Faltantes (no bloquean la firma)", "")
    for (const f of mapeo.faltantes) lineas.push(`- [ ] **${f.etiqueta}**${f.obligatorio ? " (obligatorio)" : ""}: ${f.motivo}`)
    lineas.push("")
  }
  if (d.observaciones.length > 0) {
    lineas.push("## Observaciones", "", ...d.observaciones.map((o) => `- ${o}`), "")
  }
  lineas.push(
    "## Siguientes pasos",
    "",
    "- [ ] Revisar los campos por confirmar y los faltantes",
    "- [ ] Obtener la firma del representante legal",
    "- [ ] Confirmar el envío en el chat (el agente solo simula el envío)",
    "",
  )
  return lineas.join("\n")
}

/** Valores bancarios del maestro, para verificar que nunca terminen en el correo (RN2). */
export function valoresBancarios(maestro: Maestro): string[] {
  return clavesHoja(maestro)
    .filter((c) => c.startsWith(reglas.prefijo_claves_bancarias))
    .map((c) => texto(maestro, c))
    .filter((v) => /\d/.test(v) || /^[A-Z]{6}[A-Z0-9]{2,5}$/.test(v))
}

export function contieneDatosBancarios(contenido: string, maestro: Maestro): boolean {
  return valoresBancarios(maestro).some((v) => v.length >= 4 && contenido.includes(v))
}

export function borradorCorreo(d: DatosChecklist, maestro: Maestro, adjuntos: string[]): string {
  const { solicitud } = d.caso
  const pendientes = d.soportes.filter((s) => s.estado === "vencido" || s.estado === "ausente")
  const incluidos = d.soportes.filter((s) => s.estado === "presente" || s.estado === "por_vencer")
  const razonSocial = texto(maestro, "razon_social")
  const representante = texto(maestro, "representante_legal.nombre")
  const cargo = texto(maestro, "representante_legal.cargo")

  const cuerpo = [
    `# Borrador de correo — NO ENVIADO`,
    "",
    `> Estado del paquete: **${d.listo ? "listo para firma" : "NO listo para firma"}**. Revisar, obtener la firma del representante legal y confirmar antes de enviar.`,
    "> Este borrador no incluye datos bancarios por política (RN2).",
    "",
    `**Para:** ${solicitud.de}`,
    `**Asunto:** RE: ${solicitud.asunto}`,
    `**Adjuntos:** ${adjuntos.length > 0 ? adjuntos.join(", ") : "ninguno"}`,
    "",
    "---",
    "",
    `Estimados, ${solicitud.cliente}:`,
    "",
    `Reciban un cordial saludo de ${razonSocial.replace(/\.$/, "")}.`,
    "",
    `En respuesta a su solicitud del ${solicitud.fecha}, adjuntamos el formulario de registro de proveedor diligenciado y firmado por nuestro representante legal${representante ? `, ${representante}${cargo ? ` (${cargo})` : ""}` : ""}, junto con los siguientes soportes:`,
    "",
    ...(incluidos.length > 0 ? incluidos.map((s) => `- ${s.nombre}`) : ["- (sin soportes adjuntos)"]),
    "",
  ]
  if (pendientes.length > 0) {
    cuerpo.push("Los siguientes documentos están en trámite y los enviaremos a la mayor brevedad:", "", ...pendientes.map((s) => `- ${s.nombre}`), "")
  }
  cuerpo.push(
    "Quedamos atentos a cualquier información adicional que requieran.",
    "",
    "Cordialmente,",
    "",
    texto(maestro, "contacto_financiero.nombre"),
    texto(maestro, "contacto_financiero.cargo"),
    razonSocial,
    [texto(maestro, "contacto_financiero.email"), texto(maestro, "contacto_financiero.telefono")].filter(Boolean).join(" · "),
    "",
  )
  return cuerpo.join("\n")
}
