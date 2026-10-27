import { esConfirmacion } from "../agent/confirmacion"
import type { DefinicionHerramienta, LlamadaHerramienta, Mensaje, OpcionesEnvio, ProveedorLLM, RespuestaLLM } from "./adapter"

/**
 * Proveedor determinista SIN modelo de lenguaje (LLM_PROVIDER=simulado).
 * Sirve para probar el front, el ciclo y la confirmación sin gastar una clave, y demuestra
 * que el ciclo no depende del proveedor. Solo redacta con datos que devolvieron las herramientas.
 */

type Json = Record<string, unknown>
const PASOS = ["proveedor_leer_solicitud", "proveedor_mapear_campos", "proveedor_generar_formulario", "proveedor_armar_paquete"] as const

function normal(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function parsear(contenido: string): { ok: boolean; data?: Json; error?: string } {
  try {
    return JSON.parse(contenido) as { ok: boolean; data?: Json; error?: string }
  } catch {
    return { ok: false, error: "respuesta ilegible" }
  }
}

function lista(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.map((v) => (typeof v === "string" ? v : String((v as { etiqueta?: unknown }).etiqueta ?? "")))
}

export class ProveedorSimulado implements ProveedorLLM {
  readonly nombre = "simulado"
  readonly modelo = "guion-determinista"
  private contador = 0

  constructor(private readonly casos: () => Promise<string[]>) {}

  async enviar(mensajes: Mensaje[], _herramientas: DefinicionHerramienta[], _opciones: OpcionesEnvio): Promise<RespuestaLLM> {
    const indiceUsuario = mensajes.findLastIndex((m) => m.rol === "usuario")
    const usuario = mensajes[indiceUsuario]
    const textoUsuario = usuario?.rol === "usuario" ? usuario.texto : ""
    const resultados = new Map<string, { ok: boolean; data?: Json; error?: string }>()
    for (const m of mensajes.slice(indiceUsuario + 1)) {
      if (m.rol === "resultados") for (const r of m.resultados) resultados.set(r.nombre, parsear(r.contenido))
    }

    const caso = await this.casoMencionado(textoUsuario, mensajes)
    if (!caso) return this.texto(`Puedo procesar estos casos: ${(await this.casos()).join(", ")}. Escribe por ejemplo: Procesa el caso "co-industrias-delta".`)

    const pidioEnvio = esConfirmacion(textoUsuario) && !/procesa/.test(normal(textoUsuario))
    if (pidioEnvio) {
      const envio = resultados.get("proveedor_simular_envio")
      if (!envio) return this.llamar("proveedor_simular_envio", { caso, confirmado: true })
      return this.texto(envio.ok ? `Listo. Simulé el envío: se escribió \`${String(envio.data?.ruta)}\`. No se envió ningún correo real.` : `No pude simular el envío: ${envio.error}`)
    }

    for (const paso of PASOS) {
      const previo = resultados.get(paso)
      if (!previo) return this.llamar(paso, this.argumentos(paso, caso, resultados))
      if (!previo.ok && paso === "proveedor_leer_solicitud") return this.texto(`No pude leer la solicitud: ${previo.error}`)
    }
    return this.texto(this.resumen(caso, resultados))
  }

  private async casoMencionado(texto: string, mensajes: Mensaje[]): Promise<string | null> {
    const casos = await this.casos()
    const directo = casos.find((c) => normal(texto).includes(c))
    if (directo) return directo
    for (const m of [...mensajes].reverse()) {
      if (m.rol !== "asistente") continue
      for (const l of m.llamadas) {
        const caso = (l.argumentos as { caso?: unknown } | null)?.caso
        if (typeof caso === "string") return caso
      }
    }
    return null
  }

  private argumentos(paso: string, caso: string, resultados: Map<string, { data?: Json }>): Json {
    if (paso === "proveedor_mapear_campos") return { caso, campos: lista(resultados.get("proveedor_leer_solicitud")?.data?.campos) }
    return { caso }
  }

  private resumen(caso: string, r: Map<string, { ok: boolean; data?: Json; error?: string }>): string {
    const s = r.get("proveedor_leer_solicitud")?.data ?? {}
    const m = r.get("proveedor_mapear_campos")
    const f = r.get("proveedor_generar_formulario")
    const p = r.get("proveedor_armar_paquete")
    const checklist = (p?.data?.checklist ?? {}) as Json
    const lineas = [
      `**Caso \`${caso}\`** — ${String(s.cliente ?? "")} (${String(s.pais_nombre ?? s.pais ?? "")}) · formato ${String(s.formato ?? "")}`,
      "",
      m?.ok ? `- Campos llenos: ${lista(m.data?.llenos).length}` : `- Mapeo: ${m?.error ?? "sin datos"}`,
      m?.ok ? `- Requieren confirmación: ${lista(m.data?.requiere_confirmacion).join(", ") || "ninguno"}` : "",
      m?.ok ? `- Faltantes: ${lista(m.data?.faltantes).join(", ") || "ninguno"}` : "",
      f?.ok ? `- Formulario: \`${String(f.data?.ruta)}\`${f.data?.aviso ? ` (${String(f.data.aviso).split(":")[0]})` : ""}` : `- Formulario: ${f?.error ?? "no generado"}`,
      p?.ok ? `- Soportes presentes: ${lista(checklist.soportes_presentes).join(", ") || "ninguno"}` : "",
      p?.ok ? `- Soportes por vencer: ${lista(checklist.soportes_por_vencer).join(", ") || "ninguno"}` : "",
      p?.ok ? `- Soportes ausentes: ${lista(checklist.soportes_ausentes).join(", ") || "ninguno"}` : "",
      p?.ok ? `- Soportes vencidos: ${lista(checklist.soportes_vencidos).join(", ") || "ninguno"}` : "",
      p?.ok ? `- Formulario completo: ${checklist.formulario_completo ? "sí" : "no (hay campos faltantes o por confirmar)"}` : "",
      p?.ok ? `- Paquete: \`${String(p.data?.ruta)}\` · **${p.data?.listo_para_firma ? "listo para firma" : "NO listo para firma"}**` : `- Paquete: ${p?.error ?? "no armado"}`,
      ...lista(checklist.bloqueantes).map((b) => `  - ⛔ ${b}`),
      "",
      "*(Respuesta del proveedor simulado: sin modelo de lenguaje.)*",
      "",
      `**Confirmación requerida:** ¿Confirmas que simule el envío del paquete de ${caso}${p?.data?.listo_para_firma ? "" : " aunque NO está listo para firma"}? Responde "sí, envía" para continuar.`,
    ]
    return lineas.filter((l, i, arr) => l !== "" || arr[i - 1] !== "").join("\n")
  }

  private llamar(nombre: string, argumentos: Json): RespuestaLLM {
    this.contador++
    const llamada: LlamadaHerramienta = { id: `sim_${this.contador}`, nombre, argumentos }
    return { texto: "", llamadas: [llamada], fin: "herramientas", uso: { entrada: 0, salida: 0 } }
  }

  private texto(texto: string): RespuestaLLM {
    return { texto, llamadas: [], fin: "fin_turno", uso: { entrada: 0, salida: 0 } }
  }
}
