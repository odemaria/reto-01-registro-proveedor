import { describe, expect, test } from "bun:test"
import { cargarConfig } from "../src/config"

describe("configuración tolerante a errores de tipeo en el panel del hosting", () => {
  test.each([
    [" Gemini ", "gemini"],
    ['"auto"', "auto"],
    ["SIMULADO", "simulado"],
  ])("LLM_PROVIDER=%p se lee como %p", (crudo, esperado) => {
    expect(cargarConfig({ LLM_PROVIDER: crudo }, () => {}).LLM_PROVIDER).toBe(esperado as "gemini")
  })

  test("un valor desconocido no tumba el servicio: avisa con el valor recibido y usa 'auto'", () => {
    const avisos: string[] = []
    const config = cargarConfig({ LLM_PROVIDER: "gemini-2.5-flash" }, (m) => avisos.push(m))
    expect(config.LLM_PROVIDER).toBe("auto")
    expect(avisos[0]).toContain('LLM_PROVIDER="gemini-2.5-flash" no es válido')
  })

  test("LLM_EFFORT inválido se ignora y LLM_MODEL se limpia", () => {
    const config = cargarConfig({ LLM_EFFORT: "rapido", LLM_MODEL: ' "gemini-2.5-flash" ' }, () => {})
    expect(config.LLM_EFFORT).toBeUndefined()
    expect(config.LLM_MODEL).toBe("gemini-2.5-flash")
  })

  test("la clave del modelo nunca aparece en los avisos", () => {
    const avisos: string[] = []
    cargarConfig({ LLM_PROVIDER: "xx", GEMINI_API_KEY: "clave-secreta-123" }, (m) => avisos.push(m))
    expect(avisos.join(" ")).not.toContain("clave-secreta-123")
  })
})
