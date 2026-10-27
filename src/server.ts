import { timingSafeEqual } from "node:crypto"
import { readdir } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { ejecutarTurno, type DependenciasCiclo } from "./agent/ciclo"
import { construirSistema } from "./agent/prompt"
import { AlmacenSesiones } from "./agent/sesiones"
import { cargarConfig } from "./config"
import { listarCasos } from "./dominio/caso"
import { fechaReferencia } from "./dominio/fechas"
import { salidaCaso, validarNombreCaso } from "./dominio/rutas"
import { crearProveedor } from "./llm/fabrica"
import { cargarHerramientas } from "./tools/registro"

const RAIZ = fileURLToPath(new URL("..", import.meta.url))
const WEB = join(RAIZ, "web")
const config = cargarConfig()
const ctxBase = { directory: RAIZ, sessionId: "servidor", fechaReferencia: config.FECHA_REFERENCIA }
const fecha = fechaReferencia(ctxBase)

const { proveedor, aviso } = crearProveedor(config, process.env, () => listarCasos(ctxBase))
if (aviso) console.warn(`⚠ ${aviso}`)
const sesiones = new AlmacenSesiones(config.MAX_SESIONES)
const deps: DependenciasCiclo = {
  proveedor,
  herramientas: cargarHerramientas(),
  sistema: await construirSistema(RAIZ, fecha, await listarCasos(ctxBase)),
  directorio: RAIZ,
  fechaReferencia: config.FECHA_REFERENCIA,
  maxIteraciones: config.MAX_ITERACIONES,
  maxTokensSesion: config.MAX_TOKENS_SESION,
  timeoutMs: config.LLM_TIMEOUT_MS,
}

// ───────────────────────── utilidades HTTP ─────────────────────────

const CABECERAS_SEGURIDAD = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:",
}

function json(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { "Content-Type": "application/json; charset=utf-8", ...CABECERAS_SEGURIDAD } })
}

function errorJson(mensaje: string, estado: number): Response {
  return json({ error: mensaje }, estado)
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

function claveValida(req: Request): boolean {
  if (!config.APP_ACCESS_KEY) return true
  const recibida = Buffer.from(req.headers.get("x-clave-acceso") ?? "")
  const esperada = Buffer.from(config.APP_ACCESS_KEY)
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

const solicitudesPorIp = new Map<string, number[]>()
function permitido(ip: string): boolean {
  const ahora = Date.now()
  const recientes = (solicitudesPorIp.get(ip) ?? []).filter((t) => ahora - t < 60_000)
  if (recientes.length >= config.MAX_MENSAJES_POR_MINUTO) return false
  recientes.push(ahora)
  solicitudesPorIp.set(ip, recientes)
  return true
}

// ───────────────────────── rutas ─────────────────────────

const esquemaChat = z.object({
  sessionId: z.string().max(64).optional(),
  message: z.string().trim().min(1, "El mensaje está vacío.").max(4000, "El mensaje es demasiado largo (máx. 4000 caracteres)."),
})

async function chat(req: Request, ip: string): Promise<Response> {
  if (!permitido(ip)) return errorJson("Demasiados mensajes en poco tiempo. Espera un minuto.", 429)
  let cuerpo: unknown
  try {
    cuerpo = await req.json()
  } catch {
    return errorJson("El cuerpo debe ser JSON: { sessionId, message }.", 400)
  }
  const datos = esquemaChat.safeParse(cuerpo)
  if (!datos.success) return errorJson(datos.error.issues[0]?.message ?? "Solicitud inválida.", 400)

  const sesion = sesiones.obtenerOCrear(datos.data.sessionId)
  if (sesion.ocupada) return errorJson("El agente todavía está respondiendo el mensaje anterior de esta sesión.", 409)
  sesion.ocupada = true
  try {
    sesion.historial.push({ rol: "usuario", texto: datos.data.message, ts: new Date().toISOString() })
    const turno = await ejecutarTurno(sesion, datos.data.message, deps)
    sesion.historial.push({ rol: "agente", texto: turno.reply, ts: new Date().toISOString(), toolCalls: turno.toolCalls, needsConfirmation: turno.needsConfirmation, pendingAction: turno.pendingAction, error: turno.error })
    return json({ sessionId: sesion.id, ...turno })
  } finally {
    sesion.ocupada = false
  }
}

function verSesion(id: string): Response {
  const sesion = sesiones.obtener(id)
  if (!sesion) return errorJson("La sesión no existe (las sesiones viven en memoria y se pierden al reiniciar).", 404)
  return json({ id: sesion.id, creada: sesion.creada, historial: sesion.historial, tokensUsados: sesion.tokensUsados, accionPendiente: sesion.accionPendiente })
}

async function listarArchivos(dir: string, prefijo = ""): Promise<string[]> {
  const entradas = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const archivos: string[] = []
  for (const e of entradas) {
    const relativa = prefijo ? `${prefijo}/${e.name}` : e.name
    if (e.isDirectory()) archivos.push(...(await listarArchivos(join(dir, e.name), relativa)))
    else archivos.push(relativa)
  }
  return archivos.sort()
}

const SEGMENTO_SEGURO = /^[A-Za-z0-9._-]+$/

async function archivos(partes: string[]): Promise<Response> {
  const [casoCrudo, ...resto] = partes
  const caso = validarNombreCaso(decodeURIComponent(casoCrudo ?? ""))
  if (!caso.ok) return errorJson(caso.error, 400)
  const base = salidaCaso(ctxBase, caso.data)
  if (resto.length === 0) return json({ caso: caso.data, archivos: await listarArchivos(base) })

  const segmentos = resto.map(decodeURIComponent)
  if (segmentos.some((s) => !SEGMENTO_SEGURO.test(s) || s === ".." || s === ".")) return errorJson("Ruta de archivo inválida.", 400)
  const archivo = Bun.file(join(base, ...segmentos))
  if (!(await archivo.exists())) return errorJson("El archivo no existe. ¿Ya procesaste el caso?", 404)
  const extension = extname(segmentos.at(-1) ?? "")
  const descarga = extension === ".xlsx" ? `attachment; filename="${segmentos.at(-1)}"` : "inline"
  return new Response(archivo, { headers: { "Content-Type": TIPOS[extension] ?? "application/octet-stream", "Content-Disposition": descarga, ...CABECERAS_SEGURIDAD } })
}

const ESTATICOS = new Set(["index.html", "app.js", "estilos.css", "icono.svg"])
async function estatico(ruta: string): Promise<Response> {
  const nombre = ruta === "/" ? "index.html" : ruta.slice(1)
  if (!ESTATICOS.has(nombre)) return errorJson("No encontrado.", 404)
  return new Response(Bun.file(join(WEB, nombre)), { headers: { "Content-Type": TIPOS[extname(nombre)] ?? "text/plain", ...CABECERAS_SEGURIDAD } })
}

async function enrutar(req: Request, ip: string): Promise<Response> {
  const url = new URL(req.url)
  const ruta = url.pathname
  if (req.method === "GET" && ruta === "/api/health") {
    return json({ ok: true, provider: proveedor.nombre, model: proveedor.modelo, fechaReferencia: fecha, requiereClave: Boolean(config.APP_ACCESS_KEY) })
  }
  if (ruta.startsWith("/api/") && !claveValida(req)) return errorJson("Clave de acceso inválida.", 401)
  if (req.method === "POST" && ruta === "/api/chat") return chat(req, ip)
  if (req.method === "GET" && ruta.startsWith("/api/sessions/")) return verSesion(decodeURIComponent(ruta.slice("/api/sessions/".length)))
  if (req.method === "GET" && ruta === "/api/casos") return json({ casos: await listarCasos(ctxBase) })
  if (req.method === "GET" && ruta.startsWith("/api/archivos/")) return archivos(ruta.slice("/api/archivos/".length).split("/").filter(Boolean))
  if (req.method === "GET" && !ruta.startsWith("/api/")) return estatico(ruta)
  return errorJson("Ruta no encontrada.", 404)
}

const servidor = Bun.serve({
  port: config.PORT,
  idleTimeout: 255,
  async fetch(req, srv) {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || srv.requestIP(req)?.address || "desconocida"
    const inicio = Date.now()
    let respuesta: Response
    try {
      respuesta = await enrutar(req, ip)
    } catch (error) {
      console.error("Error no controlado:", error instanceof Error ? error.message : "desconocido")
      respuesta = errorJson("Error interno del servidor.", 500)
    }
    console.log(`${req.method} ${new URL(req.url).pathname} → ${respuesta.status} (${Date.now() - inicio} ms)`)
    return respuesta
  },
})

console.log(`Agente de registro como proveedor en http://localhost:${servidor.port}`)
console.log(`Proveedor: ${proveedor.nombre} · modelo: ${proveedor.modelo} · fecha de referencia: ${fecha}`)
