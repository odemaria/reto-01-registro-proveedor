import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/registro-proveedor.md).
 * Ambos son Markdown fuera del código: cambiar reglas de negocio no toca el servidor.
 */
export async function construirSistema(raiz: string, fechaReferencia: string): Promise<string> {
  const [comportamiento, conocimiento] = await Promise.all([
    readFile(join(raiz, "agent", "prompt.md"), "utf8"),
    readFile(join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  ])
  return [
    comportamiento.trim(),
    "",
    "---",
    "",
    conocimiento.trim(),
    "",
    "---",
    "",
    `Fecha de referencia para evaluar vigencias: ${fechaReferencia}.`,
  ].join("\n")
}
