// Front del chat: HTML + JS sin dependencias. Muestra cada llamada a herramienta y resalta
// cuando el agente pide confirmación. Nunca recibe ni guarda la clave del modelo.

const $ = (id) => document.getElementById(id)
const el = {
  estado: $("estado"),
  casos: $("casos"),
  archivos: $("archivos"),
  casoActivo: $("caso-activo"),
  mensajes: $("mensajes"),
  bienvenida: $("bienvenida"),
  pensando: $("pensando"),
  compositor: $("compositor"),
  entrada: $("entrada"),
  enviar: $("enviar"),
  nuevaSesion: $("nueva-sesion"),
  formAcceso: $("form-acceso"),
  claveAcceso: $("clave-acceso"),
}

const ALMACEN = { sesion: "reto01.sesion", clave: "reto01.clave" }
const estado = { sesionId: leer(ALMACEN.sesion), clave: leer(ALMACEN.clave), ocupado: false, casoActivo: null }

function leer(llave) {
  try { return localStorage.getItem(llave) } catch { return null }
}
function guardar(llave, valor) {
  try { valor === null ? localStorage.removeItem(llave) : localStorage.setItem(llave, valor) } catch { /* modo privado */ }
}

// ───────────── API ─────────────

async function api(ruta, opciones = {}) {
  const cabeceras = { ...(opciones.headers || {}) }
  if (estado.clave) cabeceras["x-clave-acceso"] = estado.clave
  if (opciones.body) cabeceras["Content-Type"] = "application/json"
  const respuesta = await fetch(ruta, { ...opciones, headers: cabeceras })
  if (respuesta.status === 401) {
    pedirClave()
    throw new Error("Se necesita la clave de acceso.")
  }
  const cuerpo = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok) throw new Error(cuerpo.error || `Error ${respuesta.status}`)
  return cuerpo
}

// ───────────── Markdown mínimo y seguro (escapa todo antes de formatear) ─────────────

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

function enLinea(texto) {
  return escapar(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
}

function celdas(fila) {
  return fila.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
}

function markdown(texto) {
  const lineas = String(texto).replace(/\r/g, "").split("\n")
  const html = []
  let i = 0
  while (i < lineas.length) {
    const linea = lineas[i]
    if (linea.startsWith("```")) {
      const bloque = []
      i++
      while (i < lineas.length && !lineas[i].startsWith("```")) bloque.push(lineas[i++])
      i++
      html.push(`<pre><code>${escapar(bloque.join("\n"))}</code></pre>`)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(linea) && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1] || "")) {
      const cabecera = celdas(linea)
      i += 2
      const filas = []
      while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(celdas(lineas[i++]))
      html.push(`<div class="tabla"><table><thead><tr>${cabecera.map((c) => `<th>${enLinea(c)}</th>`).join("")}</tr></thead><tbody>${filas.map((f) => `<tr>${f.map((c) => `<td>${enLinea(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)
      continue
    }
    const titulo = linea.match(/^(#{1,4})\s+(.*)$/)
    if (titulo) {
      html.push(`<h${titulo[1].length < 3 ? 3 : 4}>${enLinea(titulo[2])}</h${titulo[1].length < 3 ? 3 : 4}>`)
      i++
      continue
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(linea)) {
      const ordenada = /^\s*\d+\./.test(linea)
      const items = []
      while (i < lineas.length && /^\s*([-*]|\d+\.)\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*([-*]|\d+\.)\s+/, ""))
      const etiqueta = ordenada ? "ol" : "ul"
      html.push(`<${etiqueta}>${items.map((t) => `<li>${enLinea(t)}</li>`).join("")}</${etiqueta}>`)
      continue
    }
    if (linea.startsWith(">")) {
      const citas = []
      while (i < lineas.length && lineas[i].startsWith(">")) citas.push(lineas[i++].replace(/^>\s?/, ""))
      html.push(`<blockquote>${citas.map(enLinea).join("<br>")}</blockquote>`)
      continue
    }
    if (linea.trim() === "") { i++; continue }
    const parrafo = []
    while (i < lineas.length && lineas[i].trim() !== "" && !/^(```|#|>|\s*([-*]|\d+\.)\s|\s*\|)/.test(lineas[i])) parrafo.push(lineas[i++])
    if (parrafo.length === 0) parrafo.push(lineas[i++])
    html.push(`<p>${parrafo.map(enLinea).join("<br>")}</p>`)
  }
  return html.join("")
}

// ───────────── Render ─────────────

function bajar() {
  el.mensajes.scrollTop = el.mensajes.scrollHeight
}

function json(valor) {
  if (typeof valor === "string") {
    try { return JSON.stringify(JSON.parse(valor), null, 2) } catch { return valor }
  }
  return JSON.stringify(valor, null, 2)
}

function tarjetaHerramienta(llamada) {
  const det = document.createElement("details")
  det.className = "herramienta"
  const insignia = llamada.ok ? `<span class="insignia ok">ok</span>` : `<span class="insignia falla">${llamada.bloqueadaPorPolitica ? "bloqueada" : "error"}</span>`
  det.innerHTML = `
    <summary><span aria-hidden="true">🔧</span><span class="nombre">${escapar(llamada.nombre)}</span>${insignia}<span class="resumen">${escapar(llamada.resumen)}</span></summary>
    <div class="detalle">
      <h5>Argumentos</h5><pre>${escapar(json(llamada.argumentos))}</pre>
      <h5>Resultado</h5><pre>${escapar(json(llamada.resultado))}</pre>
    </div>`
  return det
}

function agregarUsuario(texto) {
  el.bienvenida?.remove()
  const div = document.createElement("div")
  div.className = "mensaje usuario"
  div.textContent = texto
  el.mensajes.append(div)
  bajar()
}

function agregarAgente({ texto, toolCalls = [], needsConfirmation = false, pendingAction = null, error = false, ultima = true }) {
  const casoEnvio = pendingAction && pendingAction.herramienta === "proveedor_simular_envio" ? pendingAction.caso : null
  el.bienvenida?.remove()
  const div = document.createElement("div")
  div.className = `mensaje agente${error ? " error" : ""}${needsConfirmation ? " confirmacion" : ""}`
  if (toolCalls.length > 0) {
    const lista = document.createElement("div")
    lista.className = "herramientas"
    for (const llamada of toolCalls) lista.append(tarjetaHerramienta(llamada))
    div.append(lista)
  }
  if (needsConfirmation) {
    const etiqueta = document.createElement("span")
    etiqueta.className = "etiqueta-confirmacion"
    etiqueta.textContent = casoEnvio ? `⚠ Confirmación pendiente: simular el envío de ${casoEnvio}` : "⚠ El agente necesita tu confirmación"
    div.append(etiqueta)
  }
  const cuerpo = document.createElement("div")
  cuerpo.innerHTML = markdown(texto)
  div.append(cuerpo)
  if (needsConfirmation && ultima) {
    const acciones = document.createElement("div")
    acciones.className = "acciones-confirmacion"
    const si = casoEnvio
      ? boton(`Sí, confirmo el envío de ${casoEnvio}`, "primario", () => enviarMensaje(`Sí, confirmo el envío de ${casoEnvio}.`))
      : boton("Sí, confirmo", "primario", () => enviarMensaje("Sí, confirmo."))
    const no = boton("No, todavía no", "secundario", () => enviarMensaje("No, todavía no envíes nada."))
    acciones.append(si, no)
    div.append(acciones)
  }
  el.mensajes.append(div)
  const caso = [...toolCalls].reverse().find((t) => t.argumentos && typeof t.argumentos.caso === "string")?.argumentos.caso
  if (caso) mostrarArchivos(caso)
  bajar()
}

function boton(texto, clase, accion) {
  const b = document.createElement("button")
  b.type = "button"
  b.className = clase
  b.textContent = texto
  b.addEventListener("click", () => {
    b.closest(".acciones-confirmacion")?.remove()
    accion()
  })
  return b
}

function ocupado(si) {
  estado.ocupado = si
  el.pensando.classList.toggle("oculto", !si)
  el.enviar.disabled = si
  document.querySelectorAll(".casos button").forEach((b) => { b.disabled = si })
  if (si) bajar()
}

// ───────────── Acciones ─────────────

async function enviarMensaje(texto) {
  const mensaje = texto.trim()
  if (!mensaje || estado.ocupado) return
  document.querySelectorAll(".acciones-confirmacion").forEach((a) => a.remove())
  agregarUsuario(mensaje)
  ocupado(true)
  try {
    const r = await api("/api/chat", { method: "POST", body: JSON.stringify({ sessionId: estado.sesionId || undefined, message: mensaje }) })
    estado.sesionId = r.sessionId
    guardar(ALMACEN.sesion, r.sessionId)
    agregarAgente({ texto: r.reply, toolCalls: r.toolCalls, needsConfirmation: r.needsConfirmation, pendingAction: r.pendingAction, error: r.error })
  } catch (e) {
    agregarAgente({ texto: `⚠️ ${e.message}`, error: true })
  } finally {
    ocupado(false)
    el.entrada.focus()
  }
}

async function mostrarArchivos(caso) {
  estado.casoActivo = caso
  el.casoActivo.textContent = `· ${caso}`
  try {
    const { archivos } = await api(`/api/archivos/${encodeURIComponent(caso)}`)
    el.archivos.innerHTML = ""
    if (archivos.length === 0) {
      el.archivos.innerHTML = `<li class="vacio">Aún no hay archivos para este caso.</li>`
      return
    }
    for (const archivo of archivos) {
      const li = document.createElement("li")
      const a = document.createElement("a")
      a.href = `/api/archivos/${encodeURIComponent(caso)}/${archivo.split("/").map(encodeURIComponent).join("/")}`
      a.textContent = archivo
      a.target = "_blank"
      a.rel = "noopener"
      if (estado.clave) a.addEventListener("click", (ev) => { ev.preventDefault(); abrirConClave(a.href, archivo) })
      li.append(a)
      el.archivos.append(li)
    }
  } catch {
    el.archivos.innerHTML = `<li class="vacio">No se pudieron listar los archivos.</li>`
  }
}

async function abrirConClave(url, nombre) {
  const r = await fetch(url, { headers: { "x-clave-acceso": estado.clave } })
  if (!r.ok) return
  const blob = await r.blob()
  const enlace = document.createElement("a")
  enlace.href = URL.createObjectURL(blob)
  enlace.download = nombre.split("/").pop()
  enlace.click()
  setTimeout(() => URL.revokeObjectURL(enlace.href), 10_000)
}

async function cargarCasos() {
  const { casos } = await api("/api/casos")
  el.casos.innerHTML = ""
  for (const caso of casos) {
    const li = document.createElement("li")
    const b = document.createElement("button")
    b.type = "button"
    b.innerHTML = `${escapar(caso)}<span class="pais">Procesar sin enviar</span>`
    b.addEventListener("click", () => enviarMensaje(`Procesa el caso "${caso}". Dime qué campos quedaron llenos, cuáles faltan, si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.`))
    li.append(b)
    el.casos.append(li)
  }
}

async function restaurarSesion() {
  if (!estado.sesionId) return
  try {
    const s = await api(`/api/sessions/${encodeURIComponent(estado.sesionId)}`)
    s.historial.forEach((h, i) => {
      if (h.rol === "usuario") agregarUsuario(h.texto)
      else agregarAgente({ texto: h.texto, toolCalls: h.toolCalls, needsConfirmation: h.needsConfirmation, pendingAction: h.pendingAction, error: h.error, ultima: i === s.historial.length - 1 })
    })
  } catch {
    estado.sesionId = null
    guardar(ALMACEN.sesion, null)
  }
}

function pedirClave() {
  el.formAcceso.classList.remove("oculto")
  el.claveAcceso.focus()
}

async function iniciar() {
  try {
    const salud = await fetch("/api/health").then((r) => r.json())
    el.estado.innerHTML = `<span class="chip">${escapar(salud.provider)} · ${escapar(salud.model)}</span><span class="chip">vigencias al ${escapar(salud.fechaReferencia)}</span>`
    if (salud.requiereClave && !estado.clave) return pedirClave()
    await cargarCasos()
    await restaurarSesion()
  } catch (e) {
    el.estado.textContent = `Sin conexión con el servidor (${e.message})`
  }
}

el.compositor.addEventListener("submit", (ev) => {
  ev.preventDefault()
  const texto = el.entrada.value
  el.entrada.value = ""
  enviarMensaje(texto)
})
el.entrada.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault()
    el.compositor.requestSubmit()
  }
})
el.nuevaSesion.addEventListener("click", () => {
  estado.sesionId = null
  guardar(ALMACEN.sesion, null)
  location.reload()
})
el.formAcceso.addEventListener("submit", async (ev) => {
  ev.preventDefault()
  estado.clave = el.claveAcceso.value.trim()
  guardar(ALMACEN.clave, estado.clave)
  el.formAcceso.classList.add("oculto")
  await iniciar()
})

iniciar()
