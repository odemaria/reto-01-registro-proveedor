const PALABRAS_VACIAS = new Set(["de", "del", "la", "el", "los", "las", "y", "o", "en", "para", "por", "a", "al", "su"])

/** Minúsculas, sin tildes y sin signos: "Código CIIU" → "codigo ciiu". */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Raíz muy simple para comparar singular/plural: "comerciales" → "comercial". */
function raiz(palabra: string): string {
  if (palabra.length > 5 && palabra.endsWith("es")) return palabra.slice(0, -2)
  if (palabra.length > 4 && palabra.endsWith("s")) return palabra.slice(0, -1)
  return palabra
}

export function tokens(texto: string): string[] {
  return normalizar(texto.replace(/[_.]/g, " "))
    .split(" ")
    .filter((t) => t.length > 0 && !PALABRAS_VACIAS.has(t))
    .map(raiz)
}

/** Coeficiente de Dice sobre tokens (0 = nada en común, 1 = mismas palabras). */
export function similitud(a: string, b: string): number {
  const ta = new Set(tokens(a))
  const tb = new Set(tokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let comunes = 0
  for (const t of ta) if (tb.has(t)) comunes++
  return (2 * comunes) / (ta.size + tb.size)
}

/** Escapa texto para celdas de tablas Markdown. */
export function celdaMd(valor: string): string {
  return valor.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}
