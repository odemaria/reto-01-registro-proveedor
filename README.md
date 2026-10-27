# Reto 01 — Agente "Registro como Proveedor"

Agente conversacional que prepara el registro de Periferia IT Group como proveedor ante un
cliente: lee la solicitud, llena el formulario desde el repositorio maestro (Excel, PDF o
valores para portal), arma el paquete de soportes para firma y **pide confirmación humana
antes de cualquier envío** (que además es simulado).

- Planteamiento, decisiones y uso de IA: [SOLUCION.md](SOLUCION.md)
- Enunciado: `PRD.md` del proceso de selección (documento de Periferia; no se publica en este repositorio)

## Link de prueba

**https://reto-01-registro-proveedor-qzqr.onrender.com**

- Desplegado en Render (plan gratuito) con Gemini (`gemini-2.5-flash`, capa gratuita).
- Estado: [`/api/health`](https://reto-01-registro-proveedor-qzqr.onrender.com/api/health) muestra el proveedor y el modelo activos.
- El plan gratuito "duerme" el servicio tras 15 minutos sin uso: el primer acceso tarda cerca de un minuto.
- La capa gratuita de Gemini permite pocas solicitudes por minuto. Si se procesan varios casos
  seguidos, el agente espera lo que indique Google y, si aun así no alcanza, lo explica en el chat.
- Prompt de prueba: *Procesa el caso "ec-corp-andina". Dime qué campos quedaron llenos, cuáles faltan,
  si el paquete está listo para firma y qué soportes debo actualizar. No envíes nada todavía.*
  Luego: *envía*.

## Requisitos

- [Bun](https://bun.sh) 1.1 o superior (probado con 1.4.2).
- Una clave **gratuita** de Gemini, creada en [Google AI Studio](https://aistudio.google.com/apikey).
  El modelo por defecto es `gemini-2.5-flash`, que está en la capa gratuita.
- Sin clave, el servidor arranca con el **proveedor simulado** (sin modelo de lenguaje) y todo el
  flujo se puede probar igual. También hay un adaptador para Anthropic (`ANTHROPIC_API_KEY`), opcional.

## Arranque local (un comando)

```bash
bun install
```

```bash
cp .env.example .env
```

Edita `.env` y pon tu `GEMINI_API_KEY`. Luego:

```bash
bun run dev
```

Abre `http://localhost:3000`. El mismo proceso sirve el front (`web/`) y la API.

## Verificación sin modelo

```bash
bun run demo.ts
```

Limpia `out/`, ejecuta las cinco herramientas sobre los cuatro casos y los casos de error, e imprime
un resumen por caso. No necesita ninguna clave. Resultado esperado con `FECHA_REFERENCIA=2026-09-03`:

| Caso | Formato | Llenos | Por confirmar | Faltantes | Listo para firma |
|---|---|---|---|---|---|
| co-industrias-delta | xlsx | 17 | 0 | 0 | Sí |
| ec-corp-andina | pdf | 13 | 1 (RUC) | 1 (Nº contribuyente especial) | No: falta certificado de cumplimiento tributario |
| hn-agroexport-sula | xlsx | 9 | 1 (RTN) | 1 (Referencias comerciales) | No: parafiscales vencido el 2026-08-31 |
| pa-logistica-istmo | portal | 8 | 1 (RUC) | 0 | Sí (formato no soportado → `valores-portal.md`) |

## Pruebas y tipos

```bash
bun test
```

```bash
bun run typecheck
```

100 pruebas: mapeo y reglas de negocio, contrato de herramientas, generación de archivos, la matriz de
"trampas" del PRD (confirmación ligada a caso, celdas exactas, soporte vs. faltante, identificador
extranjero, datos bancarios, timeout, determinismo), tope de iteraciones, sincronía de `modulo/` y el
adaptador de Gemini con un cliente falso (no necesitan red ni clave).

## Variables de entorno

Todas están documentadas en [.env.example](.env.example). Las principales:

| Variable | Para qué | Por defecto |
|---|---|---|
| `GEMINI_API_KEY` | Clave gratuita de Google AI Studio. Solo la lee el backend. | (vacía) |
| `LLM_PROVIDER` | `auto`, `gemini`, `anthropic` o `simulado`. `auto` usa el proveedor cuya clave exista. | `auto` |
| `LLM_MODEL` | Modelo del proveedor | `gemini-2.5-flash` (o `claude-opus-5-5` con Anthropic) |
| `ANTHROPIC_API_KEY` | Opcional: proveedor alternativo | (vacía) |
| `LLM_EFFORT` | Nivel de razonamiento. Más alto = mejores decisiones pero respuestas más lentas | `low` en Gemini, `medium` en Anthropic |
| `FECHA_REFERENCIA` | Fecha contra la que se evalúan vigencias (AAAA-MM-DD) | fecha del sistema |
| `MAX_ITERACIONES` | Tope de pasos herramienta → modelo por turno | `25` |
| `MAX_TOKENS_SESION` | Tope de tokens por sesión | `400000` |
| `MAX_MENSAJES_POR_MINUTO` | Límite por IP | `20` |
| `APP_ACCESS_KEY` | Si se define, el chat pide esta clave | (vacía → link público) |

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, pendingAction, error? }` |
| `GET` | `/api/sessions/:id` | Historial completo de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model, fechaReferencia, requiereClave }` (sin claves) |
| `GET` | `/api/casos` | Casos disponibles en `fixtures/reto-01/casos/` |
| `GET` | `/api/archivos/:caso` | Archivos generados en `out/<caso>/` |
| `GET` | `/api/archivos/:caso/<ruta>` | Descarga un archivo generado |

Si `APP_ACCESS_KEY` está definida, todas las rutas `/api/*` excepto `/api/health` exigen el
header `x-clave-acceso`.

## Estructura

```
agent/prompt.md                     comportamiento (system prompt)
src/knowledge/                      conocimiento: registro-proveedor.md (para el modelo) y reglas.json (para las herramientas)
src/tools/proveedor.ts              las 5 herramientas (contrato 6.2) → proveedor_<export>
src/tools/registro.ts               publica y valida las herramientas con zod
src/dominio/                        lógica pura: mapeo, soportes, formularios, paquete, bitácora
src/agent/                          ciclo del agente, confirmación humana, sesiones
src/llm/adapter.ts                  interfaz del proveedor · gemini.ts · anthropic.ts · simulado.ts · fabrica.ts (elige)
src/server.ts                       API HTTP + archivos estáticos
web/                                front del chat (HTML + JS, sin build)
demo.ts                             herramientas sin modelo
modulo/                             bonus: agente empaquetado (generado con `bun run modulo`)
tests/                              pruebas con bun test
```

## Despliegue (Render)

1. Crea una clave gratuita en [Google AI Studio](https://aistudio.google.com/apikey).
2. En Render: **New → Blueprint** y elige este repositorio (usa `render.yaml` y el `Dockerfile`).
3. En el panel de Render, define `GEMINI_API_KEY` (y `APP_ACCESS_KEY` si quieres proteger el link).
   La clave queda solo en Render, nunca en el repositorio.
4. Verifica `https://<servicio>.onrender.com/api/health`: debe decir `"provider":"gemini"`.
5. Copia la URL pública en la sección "Link de prueba" de este README.

El plan gratuito de Render "duerme" el servicio tras 15 minutos sin uso; el primer acceso tarda
cerca de un minuto en despertar. Conviene abrir el link unos minutos antes de la defensa.

Cualquier plataforma con Docker sirve igual (Railway, Fly.io, Azure Container Apps): solo hay que
exponer el puerto `PORT` y definir las variables de entorno.

## Seguridad

- La clave del modelo solo existe como variable de entorno del backend. No está en el repo, no se
  envía al front, no aparece en logs ni en respuestas de la API (`.env` está en `.gitignore`).
- La capa gratuita de Gemini puede usar las solicitudes para mejorar los productos de Google. Por eso
  el proyecto solo usa datos ficticios, y la cuenta bancaria y la cédula se envían al modelo enmascaradas.
- Todos los datos de los fixtures son ficticios. El agente nunca pide ni guarda contraseñas de portales.
- Las herramientas no ejecutan comandos de shell y solo escriben dentro de `out/`. Los nombres de
  caso y de archivo se validan para evitar rutas arbitrarias.
