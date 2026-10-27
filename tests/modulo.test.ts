import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { contenidosModulo } from "../scripts/construir-modulo"
import * as moduloHerramientas from "../modulo/tools/proveedor"
import * as appHerramientas from "../src/tools/proveedor"
import { RAIZ } from "./utilidades"

describe("bonus: modulo/ no diverge de la aplicación", () => {
  test("agent.md y SKILL.md coinciden con sus fuentes", async () => {
    for (const [relativa, esperado] of Object.entries(await contenidosModulo(RAIZ))) {
      expect(await readFile(join(RAIZ, relativa), "utf8")).toBe(esperado)
    }
  })

  test("las herramientas del módulo son los mismos objetos que usa la app", () => {
    expect(moduloHerramientas.leer_solicitud).toBe(appHerramientas.leer_solicitud)
    expect(moduloHerramientas.simular_envio).toBe(appHerramientas.simular_envio)
  })
})
