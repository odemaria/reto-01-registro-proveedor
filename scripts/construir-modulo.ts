/**
 * Genera modulo/ (bonus 9.4) a partir de las MISMAS fuentes que usa la aplicación:
 *   agent/prompt.md                      → modulo/agent.md
 *   src/knowledge/registro-proveedor.md  → modulo/skill/registro-proveedor/SKILL.md
 *   src/tools/proveedor.ts               → modulo/tools/proveedor.ts (re-exporta, no copia)
 *
 *   bun run modulo            # genera
 *   bun run modulo --verificar  # falla si modulo/ está desactualizado (lo usa la prueba)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))

const AVISO = "<!-- Generado por scripts/construir-modulo.ts. No editar: modifica la fuente y ejecuta `bun run modulo`. -->"

export async function contenidosModulo(raiz = RAIZ): Promise<Record<string, string>> {
  const prompt = (await readFile(join(raiz, "agent", "prompt.md"), "utf8")).trim()
  const conocimiento = (await readFile(join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8")).trim()

  const agente = [
    "---",
    "description: Prepara el registro de Periferia IT Group como proveedor ante clientes (formulario, soportes y paquete para firma) sin enviar nada sin confirmación humana.",
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
    AVISO,
    "",
    prompt,
    "",
  ].join("\n")

  const skill = [
    "---",
    "name: registro-proveedor",
    "description: Conocimiento del proceso de registro como proveedor de Periferia IT Group — estados de campos, identificador tributario por país, datos bancarios, vigencia de soportes y formatos de salida.",
    "---",
    "",
    AVISO,
    "",
    conocimiento,
    "",
  ].join("\n")

  const herramientas = [
    "// Generado por scripts/construir-modulo.ts. No editar.",
    "// Las herramientas del módulo SON las de la aplicación (re-export, no copia):",
    "// cada export es { description, args (zod), execute(args, ctx) } y se publica como proveedor_<export>.",
    'export { armar_paquete, generar_formulario, leer_solicitud, mapear_campos, simular_envio } from "../../src/tools/proveedor"',
    "",
  ].join("\n")

  return {
    "modulo/agent.md": agente,
    "modulo/skill/registro-proveedor/SKILL.md": skill,
    "modulo/tools/proveedor.ts": herramientas,
  }
}

async function main(): Promise<void> {
  const verificar = process.argv.includes("--verificar")
  const contenidos = await contenidosModulo()
  const desactualizados: string[] = []
  for (const [relativa, contenido] of Object.entries(contenidos)) {
    const ruta = join(RAIZ, relativa)
    const actual = await readFile(ruta, "utf8").catch(() => null)
    if (actual === contenido) continue
    if (verificar) desactualizados.push(relativa)
    else {
      await mkdir(dirname(ruta), { recursive: true })
      await writeFile(ruta, contenido)
      console.log(`✓ ${relativa}`)
    }
  }
  if (verificar && desactualizados.length > 0) {
    console.error(`modulo/ desactualizado: ${desactualizados.join(", ")}. Ejecuta \`bun run modulo\`.`)
    process.exit(1)
  }
  if (!verificar) console.log("modulo/ al día.")
}

if (import.meta.main) await main()
