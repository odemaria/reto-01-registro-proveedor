import { reglas, nombrePais, type Glosario, type Maestro } from "./esquemas"
import { clavesHoja, notaDeClave, resolverClave, rutaEnMaestro, type ValorMaestro } from "./maestro"
import { normalizar, similitud } from "./texto"

export type OrigenMapeo = "glosario" | "regla_pais" | "clave_directa" | "similitud"

export type CampoLleno = {
  etiqueta: string
  clave: string
  ruta: string
  valor: ValorMaestro
  confianza: number
  origen: OrigenMapeo
  nota?: string
}

export type CampoPorConfirmar = {
  etiqueta: string
  clave: string
  ruta: string
  valor: ValorMaestro
  confianza: number
  origen: OrigenMapeo
  motivo: string
  /** Nombre del dato que propone el agente (ej. "RUC"). */
  propuesta?: string
  /** true si el valor se escribe en el formulario mientras se confirma (regla de país RN1). */
  se_escribe: boolean
  nota?: string
}

export type CampoFaltante = {
  etiqueta: string
  motivo: string
  obligatorio?: boolean
}

export type Mapeo = {
  pais: string
  llenos: CampoLleno[]
  requiere_confirmacion: CampoPorConfirmar[]
  faltantes: CampoFaltante[]
}

export type EtiquetaPedida = { etiqueta: string; obligatorio?: boolean | null }

type Candidato = { clave: string; confianza: number; origen: OrigenMapeo; descripcion: string }

const etiquetasTributarias = new Set(reglas.etiquetas_identificador_tributario.map(normalizar))
const etiquetasAmbiguas = new Set(reglas.etiquetas_ambiguas.map(normalizar))

function esClaveBancaria(clave: string): boolean {
  return clave.startsWith(reglas.prefijo_claves_bancarias)
}

/** Mejor clave del maestro para una etiqueta: glosario exacto → clave directa → similitud. */
function buscarCandidato(etiqueta: string, glosario: Glosario, maestro: Maestro): Candidato | null {
  const normal = normalizar(etiqueta)
  for (const [sinonimo, clave] of Object.entries(glosario)) {
    if (normalizar(sinonimo) === normal) return { clave, confianza: 1, origen: "glosario", descripcion: sinonimo }
  }
  const comoClave = normal.replace(/ /g, "_")
  const hojas = clavesHoja(maestro)
  const exacta = hojas.find((c) => c === comoClave)
  if (exacta) return { clave: exacta, confianza: 0.9, origen: "clave_directa", descripcion: exacta }
  const anidadas = hojas.filter((c) => c.endsWith(`.${comoClave}`))
  if (anidadas.length > 0) {
    // "email" existe en varios contactos: si hay más de una opción, se pide confirmación.
    const confianza = anidadas.length === 1 ? 0.85 : 0.65
    return { clave: anidadas[0] ?? comoClave, confianza, origen: "clave_directa", descripcion: anidadas.join(", ") }
  }

  let mejor: Candidato | null = null
  const opciones: Array<[string, string]> = [...Object.entries(glosario), ...hojas.map((c): [string, string] => [c, c])]
  for (const [texto, clave] of opciones) {
    const puntaje = Math.round(similitud(etiqueta, texto) * 100) / 100
    if (!mejor || puntaje > mejor.confianza) mejor = { clave, confianza: puntaje, origen: "similitud", descripcion: texto }
  }
  return mejor
}

function mapearIdentificadorTributario(pedida: EtiquetaPedida, pais: string, maestro: Maestro): Partial<Mapeo> {
  const clave = reglas.clave_identificador_tributario
  const valor = resolverClave(maestro, clave)
  const ruta = rutaEnMaestro(clave)
  if (valor === undefined) {
    return { faltantes: [{ etiqueta: pedida.etiqueta, motivo: "El maestro no tiene identificador tributario.", obligatorio: pedida.obligatorio ?? undefined }] }
  }
  const esperado = reglas.identificador_tributario_por_pais[pais] ?? "identificador tributario local"
  const extranjero = pais !== reglas.pais_maestro
  const ambigua = etiquetasAmbiguas.has(normalizar(pedida.etiqueta))

  if (!extranjero && !ambigua) {
    return { llenos: [{ etiqueta: pedida.etiqueta, clave, ruta, valor, confianza: 1, origen: "regla_pais" }] }
  }
  const motivos: string[] = []
  if (ambigua) motivos.push(`Etiqueta ambigua: en ${nombrePais(pais)} el equivalente es ${esperado}.`)
  if (extranjero) motivos.push(`Periferia solo tiene NIT colombiano; el cliente (${nombrePais(pais)}) pide ${esperado}. Se usa el NIT.`)
  return {
    requiere_confirmacion: [
      {
        etiqueta: pedida.etiqueta,
        clave,
        ruta,
        valor,
        confianza: ambigua && !extranjero ? 0.7 : 0.5,
        origen: "regla_pais",
        motivo: motivos.join(" "),
        propuesta: esperado,
        se_escribe: true,
        nota: extranjero ? "identificador extranjero" : undefined,
      },
    ],
  }
}

function mapearUna(pedida: EtiquetaPedida, pais: string, glosario: Glosario, maestro: Maestro): Partial<Mapeo> {
  if (etiquetasTributarias.has(normalizar(pedida.etiqueta))) return mapearIdentificadorTributario(pedida, pais, maestro)

  const obligatorio = pedida.obligatorio ?? undefined
  const candidato = buscarCandidato(pedida.etiqueta, glosario, maestro)
  if (!candidato || candidato.confianza < reglas.umbral_sugerencia) {
    return { faltantes: [{ etiqueta: pedida.etiqueta, motivo: "No existe en el repositorio maestro ni en el glosario.", obligatorio }] }
  }
  if (esClaveBancaria(candidato.clave) && candidato.origen !== "glosario") {
    return { faltantes: [{ etiqueta: pedida.etiqueta, motivo: "Parece un dato bancario, pero solo se llenan con coincidencia exacta del glosario (RN2).", obligatorio }] }
  }

  const valor = resolverClave(maestro, candidato.clave)
  if (valor === undefined) {
    return { faltantes: [{ etiqueta: pedida.etiqueta, motivo: `La clave "${candidato.clave}" no tiene valor en el maestro.`, obligatorio }] }
  }
  const base = { etiqueta: pedida.etiqueta, clave: candidato.clave, ruta: rutaEnMaestro(candidato.clave), valor, confianza: candidato.confianza, origen: candidato.origen, nota: notaDeClave(maestro, candidato.clave) }

  if (candidato.confianza >= reglas.umbral_confianza) return { llenos: [base] }
  return {
    requiere_confirmacion: [
      {
        ...base,
        motivo: `Mapeo ${candidato.origen === "similitud" ? "por similitud" : "por nombre de clave"} con "${candidato.descripcion}" (confianza ${candidato.confianza} < ${reglas.umbral_confianza}).`,
        se_escribe: false,
      },
    ],
  }
}

/** Cruza cada etiqueta con el maestro. Función pura: mismo insumo, mismo resultado. */
export function mapearCampos(pedidas: EtiquetaPedida[], pais: string, glosario: Glosario, maestro: Maestro): Mapeo {
  const mapeo: Mapeo = { pais, llenos: [], requiere_confirmacion: [], faltantes: [] }
  const vistas = new Set<string>()
  for (const pedida of pedidas) {
    const llave = normalizar(pedida.etiqueta)
    if (llave === "" || vistas.has(llave)) continue
    vistas.add(llave)
    const parcial = mapearUna(pedida, pais, glosario, maestro)
    mapeo.llenos.push(...(parcial.llenos ?? []))
    mapeo.requiere_confirmacion.push(...(parcial.requiere_confirmacion ?? []))
    mapeo.faltantes.push(...(parcial.faltantes ?? []))
  }
  return mapeo
}

function enmascarar(valor: ValorMaestro): string {
  const texto = String(valor)
  return texto.length <= 4 ? "****" : `${"*".repeat(texto.length - 4)}${texto.slice(-4)}`
}

/**
 * Copia del mapeo para el modelo, el chat y mapeo.json: los valores sensibles (cuenta, cédula)
 * salen enmascarados. El valor real solo se escribe en el formulario, que lo lee del maestro.
 * Así el modelo no puede repetir ni reescribir esos datos.
 */
export function mapeoSeguro(mapeo: Mapeo): Mapeo {
  const sensibles = new Set(reglas.claves_sensibles)
  const tapar = <T extends { clave: string; valor: ValorMaestro; nota?: string }>(c: T): T =>
    sensibles.has(c.clave) ? { ...c, valor: enmascarar(c.valor), nota: [c.nota, "valor enmascarado; el formulario lleva el dato completo del maestro"].filter(Boolean).join(" · ") } : c
  return { ...mapeo, llenos: mapeo.llenos.map(tapar), requiere_confirmacion: mapeo.requiere_confirmacion.map(tapar) }
}

/** Valor que se escribe en el formulario para una etiqueta (vacío si es faltante o no confirmado). */
export function valorParaFormulario(mapeo: Mapeo, etiqueta: string): { valor: ValorMaestro; nota?: string } | null {
  const llave = normalizar(etiqueta)
  const lleno = mapeo.llenos.find((c) => normalizar(c.etiqueta) === llave)
  if (lleno) return { valor: lleno.valor, nota: lleno.nota }
  const porConfirmar = mapeo.requiere_confirmacion.find((c) => normalizar(c.etiqueta) === llave && c.se_escribe)
  if (porConfirmar) return { valor: porConfirmar.valor, nota: porConfirmar.nota }
  return null
}
