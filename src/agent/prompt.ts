import { readFile } from "node:fs/promises"
import { join } from "node:path"

/**
 * System prompt = comportamiento (agent/prompt.md) + conocimiento (src/knowledge/registro-proveedor.md).
 * Ambos son Markdown fuera del código: cambiar reglas de negocio no toca el servidor.
 */
export async function construirSistema(raiz: string, fechaReferencia: string, casos: string[] = []): Promise<string> {
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
    casos.length > 0
      ? `Casos disponibles (nombre exacto que reciben las herramientas): ${casos.join(", ")}. Si la analista pregunta qué casos hay, responde con esta lista sin llamar herramientas; nunca llames una herramienta con el caso vacío.`
      : "",
  ].join("\n")
}
