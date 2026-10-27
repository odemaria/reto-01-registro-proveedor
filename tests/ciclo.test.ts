import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { ejecutarTurno, type DependenciasCiclo } from "../src/agent/ciclo"
import { esConfirmacion, pideConfirmacion } from "../src/agent/confirmacion"
import { AlmacenSesiones } from "../src/agent/sesiones"
import { listarCasos } from "../src/dominio/caso"
import { ErrorProveedor, type Mensaje, type ProveedorLLM, type RespuestaLLM } from "../src/llm/adapter"
import { ProveedorSimulado } from "../src/llm/simulado"
import { cargarHerramientas } from "../src/tools/registro"
import { proyectoTemporal } from "./utilidades"
import type { ContextoHerramienta } from "../src/dominio/contexto"

let ctx: ContextoHerramienta
let limpiar: () => Promise<void>
beforeAll(async () => {
  const p = await proyectoTemporal()
  ctx = p.ctx
  limpiar = p.limpiar
})
afterAll(() => limpiar())

function deps(proveedor: ProveedorLLM, extra: Partial<DependenciasCiclo> = {}): DependenciasCiclo {
  return {
    proveedor,
    herramientas: cargarHerramientas(),
    sistema: "prueba",
    directorio: ctx.directory,
    fechaReferencia: ctx.fechaReferencia,
    maxIteraciones: 25,
    maxTokensSesion: 1_000_000,
    timeoutMs: 5_000,
    ...extra,
  }
}

/** Proveedor de prueba que siempre intenta enviar, aunque nadie lo haya confirmado. */
class ProveedorImpaciente implements ProveedorLLM {
  readonly nombre = "impaciente"
  readonly modelo = "prueba"
  async enviar(mensajes: Mensaje[]): Promise<RespuestaLLM> {
    const ultimo = mensajes.at(-1)
    if (ultimo?.rol === "resultados") return { texto: "Listo.", llamadas: [], fin: "fin_turno", uso: { entrada: 1, salida: 1 } }
    return {
      texto: "",
      llamadas: [{ id: "x1", nombre: "proveedor_simular_envio", argumentos: { caso: "co-industrias-delta", confirmado: true } }],
      fin: "herramientas",
      uso: { entrada: 1, salida: 1 },
    }
  }
}

describe("detección de confirmación", () => {
  test.each(["sí", "Sí, envía", "envía", "confirmo", "ok, adelante"])("'%s' confirma", (t) => expect(esConfirmacion(t)).toBe(true))
  test.each(["No envíes nada todavía", "espera", "procesa el caso", "no, cancela"])("'%s' no confirma", (t) => expect(esConfirmacion(t)).toBe(false))
  test("detecta la marca de confirmación del prompt", () => {
    expect(pideConfirmacion("Resumen…\n\n**Confirmación requerida:** ¿Confirmas que simule el envío?")).toBe(true)
    expect(pideConfirmacion("El paquete está listo.")).toBe(false)
  })
})

describe("ciclo del agente", () => {
  test("RN4: bloquea el envío si el usuario no confirmó, aunque el modelo pase confirmado:true", async () => {
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const turno = await ejecutarTurno(sesion, "envía el caso co-industrias-delta", deps(new ProveedorImpaciente()))
    expect(turno.toolCalls[0]?.bloqueadaPorPolitica).toBe(true)
    expect(existsSync(join(ctx.directory, "out", "co-industrias-delta", "ENVIO-SIMULADO.md"))).toBe(false)
  })

  test("flujo completo con proveedor simulado: procesa, pide confirmación y solo envía tras el 'sí'", async () => {
    const d = deps(new ProveedorSimulado(() => listarCasos(ctx)))
    const sesion = new AlmacenSesiones(10).obtenerOCrear()

    const t1 = await ejecutarTurno(sesion, 'Procesa el caso "ec-corp-andina". No envíes nada todavía.', d)
    expect(t1.toolCalls.map((c) => c.nombre)).toEqual([
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_generar_formulario",
      "proveedor_armar_paquete",
    ])
    expect(t1.needsConfirmation).toBe(true)
    expect(t1.reply).toContain("NO listo para firma")

    const t2 = await ejecutarTurno(sesion, "envía", d)
    expect(t2.toolCalls[0]?.nombre).toBe("proveedor_simular_envio")
    expect(t2.toolCalls[0]?.ok).toBe(true)
    expect(existsSync(join(ctx.directory, "out", "ec-corp-andina", "ENVIO-SIMULADO.md"))).toBe(true)
  })

  test("CA1: respeta el tope de iteraciones y responde con lo que tiene", async () => {
    const infinito: ProveedorLLM = {
      nombre: "bucle",
      modelo: "prueba",
      async enviar() {
        return { texto: "", llamadas: [{ id: crypto.randomUUID(), nombre: "proveedor_leer_solicitud", argumentos: { caso: "co-industrias-delta" } }], fin: "herramientas", uso: { entrada: 1, salida: 1 } }
      },
    }
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const turno = await ejecutarTurno(sesion, "hola", deps(infinito, { maxIteraciones: 3 }))
    expect(turno.toolCalls).toHaveLength(3)
    expect(turno.reply).toContain("tope de 3 pasos")
  })

  test("CA5: un error del proveedor se explica en el chat y la sesión sigue viva", async () => {
    const roto: ProveedorLLM = {
      nombre: "roto",
      modelo: "prueba",
      async enviar() {
        throw new ErrorProveedor("El modelo tardó demasiado en responder. Intenta de nuevo.", true)
      },
    }
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    const turno = await ejecutarTurno(sesion, "hola", deps(roto))
    expect(turno.error).toBe(true)
    expect(turno.reply).toContain("tardó demasiado")
    const otro = await ejecutarTurno(sesion, "hola de nuevo", deps(new ProveedorSimulado(() => listarCasos(ctx))))
    expect(otro.error).toBeUndefined()
  })

  test("tope de tokens por sesión", async () => {
    const sesion = new AlmacenSesiones(10).obtenerOCrear()
    sesion.tokensUsados = 50_000
    const turno = await ejecutarTurno(sesion, "hola", deps(new ProveedorImpaciente(), { maxTokensSesion: 10_000 }))
    expect(turno.reply).toContain("tope de uso")
  })
})
