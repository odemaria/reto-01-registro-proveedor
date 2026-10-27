# Reto 01 — Agente "Registro como Proveedor"

Agente conversacional que prepara el registro de Periferia IT Group como proveedor ante un
cliente: lee la solicitud, llena el formulario desde el repositorio maestro (Excel, PDF o
valores para portal), arma el paquete de soportes para firma y **pide confirmación humana
antes de cualquier envío** (que además es simulado).

- Planteamiento, decisiones y uso de IA: [SOLUCION.md](SOLUCION.md)
- Enunciado: `PRD.md` del proceso de selección (documento de Periferia; no se publica en este repositorio)

## Link de prueba

> **Pendiente de completar por el candidato tras desplegar:** `https://<servicio>.onrender.com`
> Si se define `APP_ACCESS_KEY`, la clave de acceso se entrega por el canal de la entrega (no en este archivo).

## Requisitos

- [Bun](https://bun.sh) 1.1 o superior (probado con 1.4.2).
- Opcional: una clave de Anthropic. Sin clave el servidor arranca con el **proveedor simulado**
  (sin modelo de lenguaje) y todo el flujo se puede probar igual.

## Arranque local (un comando)

```bash
bun install
```

```bash
cp .env.example .env
```

Edita `.env` y pon tu `ANTHROPIC_API_KEY` (opcional). Luego:

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

73 pruebas: mapeo y reglas de negocio, contrato de herramientas, generación de archivos, la matriz de
"trampas" del PRD (confirmación ligada a caso, celdas exactas, soporte vs. faltante, identificador
extranjero, datos bancarios, timeout, determinismo), tope de iteraciones y sincronía de `modulo/`.

## Variables de entorno

Todas están documentadas en [.env.example](.env.example). Las principales:

| Variable | Para qué | Por defecto |
|---|---|---|
| `ANTHROPIC_API_KEY` | Clave del modelo. Solo la lee el SDK en el backend. | (vacía → simulado) |
| `LLM_PROVIDER` | `anthropic` o `simulado` | `anthropic` |
| `LLM_MODEL` | Modelo de Claude | `claude-opus-5-5` |
| `LLM_EFFORT` | Esfuerzo de razonamiento | `medium` |
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
src/llm/adapter.ts                  interfaz del proveedor · anthropic.ts · simulado.ts
src/server.ts                       API HTTP + archivos estáticos
web/                                front del chat (HTML + JS, sin build)
demo.ts                             herramientas sin modelo
modulo/                             bonus: agente empaquetado (generado con `bun run modulo`)
tests/                              pruebas con bun test
```

## Despliegue (Render)

1. Sube el repositorio a GitHub.
2. En Render: **New → Blueprint** y elige el repositorio (usa `render.yaml` y el `Dockerfile`).
3. En el panel, define `ANTHROPIC_API_KEY` (y `APP_ACCESS_KEY` si quieres proteger el link).
4. Copia la URL pública en la sección "Link de prueba" de este README.

Cualquier plataforma con Docker sirve igual (Railway, Fly.io, Azure Container Apps): solo hay que
exponer el puerto `PORT` y definir las variables de entorno.

## Seguridad

- La clave del modelo solo existe como variable de entorno del backend. No está en el repo, no se
  envía al front, no aparece en logs ni en respuestas de la API (`.env` está en `.gitignore`).
- Todos los datos de los fixtures son ficticios. El agente nunca pide ni guarda contraseñas de portales.
- Las herramientas no ejecutan comandos de shell y solo escriben dentro de `out/`. Los nombres de
  caso y de archivo se validan para evitar rutas arbitrarias.
