import { z } from "zod"
import { armar, esquemaMapeoPropuesto, generar, leerSolicitud, mapear, simularEnvio } from "../dominio/operaciones"
import { definirHerramienta, ejecutarSeguro } from "./tipos"

/**
 * Herramientas del agente. El nombre que ve el modelo es `<archivo>_<export>`:
 * proveedor_leer_solicitud, proveedor_mapear_campos, … Son la ÚNICA fuente de valores
 * que el agente puede afirmar (CA2). Se pueden importar sin el servidor (demo.ts, modulo/).
 */

const caso = z.string().min(1).max(64).describe('Nombre de la carpeta del caso en fixtures/reto-01/casos/ (ej. "co-industrias-delta")')

export const leer_solicitud = definirHerramienta({
  description: "Lee el correo y la plantilla de un caso: devuelve país, cliente, formato de salida, campos pedidos y soportes exigidos.",
  args: { caso },
  async execute(args, ctx) {
    return ejecutarSeguro("proveedor_leer_solicitud", ctx, args.caso, () => leerSolicitud(ctx, args.caso), (d) =>
      `${d.caso}: ${d.pais} · ${d.formato} · ${d.campos.length} campos · ${d.soportes.length} soportes${d.advertencias.length ? ` · ${d.advertencias.length} advertencias` : ""}`,
    )
  },
})

export const mapear_campos = definirHerramienta({
  description: "Cruza los campos pedidos con el repositorio maestro y deja cada uno como lleno, faltante o requiere_confirmacion, sin inventar valores.",
  args: {
    caso,
    campos: z
      .array(z.string().min(1).max(200))
      .max(200)
      .describe("Etiquetas de los campos tal como vienen en la plantilla (salida `campos` de proveedor_leer_solicitud). Vacío = todos los de la plantilla."),
  },
  async execute(args, ctx) {
    return ejecutarSeguro("proveedor_mapear_campos", ctx, args.caso, () => mapear(ctx, args.caso, args.campos), (d) =>
      `${args.caso}: ${d.llenos.length} llenos, ${d.requiere_confirmacion.length} por confirmar, ${d.faltantes.length} faltantes`,
    )
  },
})

export const generar_formulario = definirHerramienta({
  description: "Genera el formulario lleno en el formato del cliente (xlsx o pdf); para portal web genera valores-portal.md porque ese formato no se llena automáticamente.",
  args: {
    caso,
    mapeo: esquemaMapeoPropuesto
      .optional()
      .describe("Salida de proveedor_mapear_campos. Es solo referencia: los valores siempre se releen del maestro. Si se omite, se recalcula."),
  },
  async execute(args, ctx) {
    return ejecutarSeguro("proveedor_generar_formulario", ctx, args.caso, () => generar(ctx, args.caso, args.mapeo), (d) =>
      `${args.caso}: ${d.formato}${d.soportado ? "" : " (no soportado)"} → ${d.ruta}`,
    )
  },
})

export const armar_paquete = definirHerramienta({
  description: "Arma out/<caso>/paquete/ con el formulario, los soportes vigentes, checklist.md y borrador-correo.md, e indica si está listo para firma.",
  args: { caso },
  async execute(args, ctx) {
    return ejecutarSeguro("proveedor_armar_paquete", ctx, args.caso, () => armar(ctx, args.caso), (d) =>
      `${args.caso}: listo_para_firma=${d.listo_para_firma} · ${d.checklist.bloqueantes.length} bloqueantes · ${d.archivos.length} archivos`,
    )
  },
})

export const simular_envio = definirHerramienta({
  description: "Simula el envío del paquete escribiendo ENVIO-SIMULADO.md; solo funciona si el usuario confirmó explícitamente en su último mensaje.",
  args: {
    caso,
    confirmado: z.boolean().describe("true solo si el usuario confirmó el envío de forma explícita en su último mensaje."),
  },
  async execute(args, ctx) {
    return ejecutarSeguro("proveedor_simular_envio", ctx, args.caso, () => simularEnvio(ctx, args.caso, args.confirmado), (d) =>
      `${args.caso}: ENVIO-SIMULADO.md escrito${d.listo_para_firma ? "" : " (con bloqueantes)"}`,
    )
  },
})
