# SOLUCIÓN — Reto 01: Agente "Registro como Proveedor"

## 1. Problema en una frase

El área administrativa transcribe a mano, entre 8 y 12 veces al mes, los mismos datos de Periferia
(NIT, dirección, cuenta bancaria…) en los formularios de registro que piden los clientes. Eso
consume horas, arriesga errores en datos sensibles y depende de una persona que se va.
**Les duele a** la analista administrativa (retrabajo), al representante legal (recibe paquetes
incompletos) y a la empresa (se retrasa la facturación).

## 2. Arquitectura

```
┌───────────────────┐  POST /api/chat   ┌──────────────────────────────────────────────┐
│ web/ (HTML + JS)  │ ────────────────▶ │ src/server.ts (Bun.serve)                    │
│ · historial       │ ◀──────────────── │  · sesiones en memoria (src/agent/sesiones)  │
│ · tarjetas de     │  reply, toolCalls,│  · tope de mensajes por IP, clave opcional   │
│   herramientas    │  needsConfirmation│                                              │
│ · banner de       │                   │ src/agent/ciclo.ts  ← ciclo del agente       │
│   confirmación    │                   │  prompt → modelo → herramientas → respuesta  │
└───────────────────┘                   │  · tope de iteraciones y de tokens           │
                                        │  · compuerta de confirmación (RN4)           │
                                        │       │                    │                 │
                                        │       ▼                    ▼                 │
                                        │ src/llm/adapter.ts   src/tools/registro.ts   │
                                        │  ├ gemini.ts          valida con zod y llama │
                                        │  ├ anthropic.ts       src/tools/proveedor.ts │
                                        │  └ simulado.ts                               │
                                        └───────────────────────────┬──────────────────┘
                                                                    │ src/dominio/* (lógica pura)
                                         fixtures/ (solo lectura) ◀─┴─▶ out/ (escritura + log.jsonl)
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Cómo trabaja el agente, regla de oro (solo afirma lo que salió de herramientas), formato del resumen, protocolo de confirmación. |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` (para el modelo) y `src/knowledge/reglas.json` (para las herramientas) | Estados de campos, identificador por país, política bancaria, vigencias, formatos. Cambiar una regla (umbral, país nuevo, días de alerta) no toca código. |
| **Ejecución** | `src/tools/proveedor.ts` + `src/dominio/` | Las 5 herramientas del contrato 6.2 y la lógica determinista que las respalda. |

El system prompt se arma al arrancar uniendo comportamiento + conocimiento + fecha de referencia
(`src/agent/prompt.ts`).

## 3. Ciclo del agente

Implementado a mano en `src/agent/ciclo.ts` (sin frameworks de agentes):

1. Se agrega el mensaje del usuario a la sesión. **Antes**, el código decide si ese mensaje autoriza
   algo (`src/agent/confirmacion.ts`). Al cerrar cada turno, si el agente pidió confirmación, la
   sesión guarda una **acción pendiente concreta** `{ herramienta: "proveedor_simular_envio", caso }`
   (el caso que nombra la pregunta o, si no nombra ninguno, el último paquete armado). El mensaje
   siguiente solo autoriza si: hay acción pendiente, es afirmativo sin negaciones ("sí", "envía",
   "confirmo"… pero no "no envíes nada todavía") y no menciona otro caso. La autorización vale
   **solo para ese caso, esa herramienta, ese turno y un único uso**.
2. Se llama al proveedor con el historial, las definiciones de herramientas (JSON Schema generado
   desde zod) y el system prompt, con un **timeout duro** (`Promise.race` + `AbortController`): aunque
   un proveedor ignore la cancelación, el turno termina con un mensaje claro.
3. Si el modelo pide herramientas, cada llamada se valida con zod y se ejecuta. La herramienta
   `proveedor_simular_envio` está marcada como acción externa: si no hay autorización vigente para
   esa acción y ese caso, el ciclo **no la ejecuta** y devuelve al modelo
   `requiere confirmación explícita: <motivo>` (sin acción pendiente, otro caso, otra acción o
   confirmación ya usada), aunque el modelo haya enviado `confirmado: true`. La confirmación la
   garantiza el código, no el prompt. La API devuelve además `pendingAction` y el front muestra
   "Confirmación pendiente: simular el envío de <caso>".
4. Los resultados vuelven al modelo y se repite hasta que responde sin herramientas.
5. **Topes**: `MAX_ITERACIONES` (25 por defecto) por turno; al alcanzarlo se responde con lo hecho y
   lo pendiente. `MAX_TOKENS_SESION` corta la sesión con un mensaje claro. Además hay límite de
   mensajes por minuto por IP.
6. Si la respuesta final contiene la marca `**Confirmación requerida:**` (que exige el prompt) o
   termina en una pregunta de confirmación, la API devuelve `needsConfirmation: true` y el front
   resalta el mensaje con botones "Sí, confirmo" / "No, todavía no".
7. Errores del proveedor (clave inválida, timeout, límite de tasa, caída) se traducen a frases
   claras con las clases tipadas del SDK. La sesión no muere: el siguiente mensaje funciona.

El historial que ve el modelo **solo crece** (nunca se edita): la respuesta original del proveedor se
guarda en `crudo` y se reenvía tal cual, como exige la API con razonamiento adaptativo.

Toda llamada a herramienta queda en el chat (tarjeta con nombre, argumentos, resumen y resultado) y
en `out/log.jsonl` y `out/<caso>/log.jsonl` con `{ ts, sesion, herramienta, ok, resumen }`.

## 4. Elección del modelo

| | |
|---|---|
| Proveedor del link de prueba | **Google Gemini** (API de Google AI Studio, SDK oficial `@google/genai`), capa gratuita |
| Modelo por defecto | `gemini-2.5-flash` con razonamiento bajo (`thinkingBudget` de 1024 tokens). Configurable con `LLM_MODEL` y `LLM_EFFORT`. |
| Por qué | Está en la capa gratuita según la página oficial de precios de Google, soporta llamadas a funciones con esquemas JSON y basta para orquestar 4–5 herramientas. La clave gratuita evita gastar una clave de pago con un link público. |
| Lo que se descartó | Primero se usó `gemini-3.8-flash` (el más nuevo de la capa gratuita). En el despliegue, cada respuesta tardaba más de 60–90 s, incluso con razonamiento bajo, y un caso completo (≈5 llamadas) no alcanzaba a terminar. Los registros de diagnóstico (`[llm]` en los logs) lo mostraron. Se cambió a `gemini-2.5-flash`. |
| Modelo según la clave | Luego, la clave del despliegue respondió 404 para `gemini-2.5-flash`, aunque la página de precios lo lista como gratuito: la disponibilidad real depende de la clave y del proyecto. Por eso, al arrancar, el adaptador consulta a Google qué modelos acepta la clave (`models.list`) y, si el configurado no está, usa el primero disponible de una lista de preferencia (`PREFERENCIA_MODELOS`, flash rápidos primero). Un 404 en plena solicitud también cambia de modelo. `/api/health` muestra el modelo configurado, el activo y los disponibles (sin datos secretos). |
| Alternativa incluida | Adaptador de Anthropic (`claude-opus-5-5`) en `src/llm/anthropic.ts`. Se activa solo con `ANTHROPIC_API_KEY`; no se usó en el despliegue. |
| Selección | `LLM_PROVIDER=auto` (por defecto): Gemini si hay `GEMINI_API_KEY`, Anthropic si hay la suya, si no el simulado. El ciclo del agente es el mismo para los tres: así se demuestra que cambiar de proveedor no lo toca. |

**Costo estimado por caso:** un caso completo son ~5 llamadas al modelo, con ~40 mil tokens de
entrada y ~4 mil de salida en total (el historial crece con los resultados de las herramientas).
- **Con Gemini en la capa gratuita: US$0.** El límite es de solicitudes por minuto y por día (Google
  ajusta las cifras por proyecto); el adaptador reintenta ante un `429` y, si sigue el límite, el chat
  lo explica. Para 8–12 casos al mes sobra.
- Si en producción se pasara a un plan de pago (Gemini o Anthropic), el costo seguiría siendo de
  centavos por caso: con Claude Opus 5.5 (US$4 / US$20 por millón) serían ≈ US$0,24 por caso.

El uso real queda en `/api/sessions/:id` → `tokensUsados`.

## 5. Diseño del portal web (no implementado, sección 7.4)

**Hoy** el caso `pa-logistica-istmo` responde "formato no soportado" y genera
`out/<caso>/valores-portal.md` con una tabla etiqueta | valor | estado lista para copiar.

**Estrategia propuesta (fase 2): navegador controlado por el agente, con el humano al mando.**

| Paso | Quién | Cómo |
|---|---|---|
| 1. Abrir el portal | Agente | Navegador automatizado (Playwright) en una sesión aislada, visible para la analista. |
| 2. Iniciar sesión | **Humano** | La analista escribe usuario y contraseña directamente en el navegador. También resuelve CAPTCHA y MFA. El agente no ve ni recibe las credenciales. |
| 3. Llenar campos | Agente | Usa el mismo mapeo de `proveedor_mapear_campos`. Cada campo del portal se ubica por etiqueta visible (texto del `<label>`/aria), no por selectores CSS fijos, para tolerar cambios de diseño. Los campos sin coincidencia segura se dejan vacíos y se reportan. |
| 4. Cargar soportes | Agente | Sube los archivos vigentes del paquete. |
| 5. Revisión | **Humano** | El agente muestra una captura y el resumen de lo llenado; la analista corrige si hace falta. |
| 6. Clic en "Enviar" | **Humano** | Siempre. El agente nunca pulsa botones de envío ni de aceptación de términos. |

**Alternativas evaluadas:** RPA tradicional (UiPath/Power Automate): robusto pero un flujo por
portal, costoso de mantener con 5 países y clientes variables. Extensión de navegador que rellena
desde `valores-portal.md`: simple y segura (corre en la sesión de la analista), buena opción
intermedia si el navegador automatizado no es viable.

**Límites:** CAPTCHA y MFA son humanos por diseño. Un cambio de diseño del portal puede romper la
ubicación de campos: por eso se usan etiquetas visibles y, si no hay coincidencia segura, se deja el
campo vacío en vez de adivinar. Portales con sesión corta: el agente trabaja después del login, sin
reintentar credenciales.

**Credenciales:** nunca en el repositorio, el prompt, el historial del modelo ni los logs. El cliente
las envía al representante legal; si hubiera que guardarlas, irían en el gestor de contraseñas
corporativo (por ejemplo Bitwarden o Azure Key Vault) y las ingresaría la persona en el navegador.
El agente solo recibe la URL del portal (que viene en el correo).

## 6. Decisiones y trade-offs

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| 1 | **El mapeo campo → maestro es determinista** (glosario, regla de país, similitud de palabras con umbrales 0,8 / 0,6) dentro de la herramienta. El modelo solo orquesta y redacta. | Pedirle al modelo que mapee y escriba los valores. | El PRD exige no inventar nunca y trazabilidad. Con código, cada valor trae `ruta` en el maestro, el resultado es reproducible (lo verifica `demo.ts`) y se puede probar con tests. |
| 2 | **La confirmación humana se aplica en el código** como máquina de estados: acción pendiente `{herramienta, caso}` → autorización de un solo uso. | Confiar en el prompt, o aceptar cualquier "sí" como permiso general. | Un modelo puede equivocarse o ser manipulado (por ejemplo, con texto en el correo del cliente), y un "sí" genérico podría autorizar el envío de otro caso. Hay tests para: "envía" sin pregunta, "sí" sin acción pendiente, cambio de caso, acción distinta, confirmación reutilizada. |
| 3 | **`generar_formulario` ignora los valores que mande el modelo** en `mapeo`: relee el maestro y solo avisa si la clave propuesta difiere. | Escribir lo que llegue en `mapeo`. | Así un valor alucinado nunca llega al formulario (CA2). |
| 3b | **Valores sensibles enmascarados hacia el modelo** (cuenta bancaria y cédula, lista en `reglas.json`): `mapear_campos` y `mapeo.json` muestran `*******2345`; solo el formulario lleva el dato completo, leído del maestro. | Enviar los valores completos al modelo. | El modelo no los necesita para orquestar, no puede repetirlos ni reescribirlos, y no viajan al proveedor del modelo ni al historial del chat. |
| 4 | **Fecha de referencia configurable** (`FECHA_REFERENCIA`, por defecto la del sistema; `2026-09-03` en demo y `.env.example`). | Modificar `vigencia_hasta` en los fixtures para que "pasen" las pruebas. | El PRD prohíbe modificar los fixtures. Con la fecha real (octubre de 2026) la Cámara de Comercio ya venció y ningún caso estaría listo, lo que ocultaría los escenarios que el reto quiere probar (ausente en EC, vencido en HN). La fecha configurable reproduce esos escenarios sin tocar datos y deja el comportamiento real para producción. |
| 5 | **Ciclo propio** con interfaz `ProveedorLLM` y tres implementaciones (Gemini, Anthropic y simulado). | El *tool runner* del SDK o un framework de agentes. | El PRD exige que cambiar de proveedor no toque el ciclo, y necesitaba la compuerta de confirmación entre llamadas. El proveedor simulado permite probar el front y el flujo completo sin clave. |
| 6 | **PDF generado** con `pdf-lib` (Helvetica, fechas fijas). | Rellenar un AcroForm. | No hay PDF real del cliente en los fixtures y el PRD acepta un PDF generado con etiquetas y valores en orden. |
| 7 | **Front en HTML + JS sin build**, servido por el mismo proceso. | React/Vite. | Un solo comando arranca todo, cero configuración, y el alcance (chat + tarjetas + confirmación) no justifica un framework. |

**Dependencias** (todas justificadas): `zod` (obligatorio, validación de argumentos y de fixtures),
`@anthropic-ai/sdk` (cliente oficial), `exceljs` (escribir celdas exactas en hojas con nombre),
`pdf-lib` (PDF sin binarios nativos). Desarrollo: `typescript`, `bun-types`, `@types/node`.

## 7. Supuestos

1. Las vigencias se evalúan contra `FECHA_REFERENCIA`. Un soporte con `vigencia_hasta` igual a la
   fecha de referencia sigue vigente; vence al día siguiente.
2. Un soporte que vence en 15 días o menos se marca "por vencer" (alerta, no bloquea).
3. Los soportes vencidos **no** se copian al paquete; los ausentes se listan como "en trámite" en el
   borrador de correo.
4. `listo_para_firma` también exige que el formulario se haya generado.
5. `requiere_confirmacion` no bloquea la firma (igual que `faltante`); la analista lo revisa en el checklist.
6. El identificador extranjero se **escribe** en el formulario (RN1 dice "se llena con el NIT"), con
   la nota "identificador extranjero". Un mapeo de baja confianza **no** se escribe hasta confirmarlo.
7. "Correo electrónico" se llena con el del contacto comercial porque así lo define el glosario.
8. "País" se escribe como está en el maestro (`CO`), sin traducirlo a "Colombia", para no transformar datos.
9. El caso de portal trae `plantilla-campos.json` (el PRD solo lo menciona para PDF): se usa como
   lista de campos del portal.
10. La exigencia "Cámara de Comercio no mayor a 30 días" del correo colombiano se cubre con
    `vigencia_hasta` del índice; no se calcula la antigüedad del documento.
11. El PRD menciona la "rúbrica de la sección 10", pero esa sección trata de riesgos: se asumió que
    la rúbrica se entrega aparte.
12. **Logs:** CA4 pide `out/log.jsonl` y RN5 pide `out/<caso>/log.jsonl`; no se asumió que fueran lo
    mismo: cada llamada se escribe en **ambos** (el global también registra errores sin caso válido).
    Solo se guarda `{ ts, sesion, herramienta, ok, resumen }`, nunca valores.
13. **Confianza < 0,8:** el PRD no dice cómo calcularla. Criterio determinista, sin cifras del modelo:
    glosario exacto = 1,0; nombre de clave del maestro único = 0,9 (0,85 si es anidada; 0,65 si
    existe en varios objetos, ej. "email"); en otro caso, similitud de Dice entre palabras de la
    etiqueta y del glosario. ≥ 0,8 → `lleno`; 0,6–0,8 → `requiere_confirmacion` (no se escribe);
    < 0,6 → `faltante`. Datos bancarios solo con coincidencia exacta del glosario.
14. **"Listo para firma" no es "completo":** el checklist y la herramienta muestran por separado
    `listo_para_firma` y `formulario_completo`, y los soportes presentes, por vencer, ausentes y vencidos.
15. **Confirmación "del turno inmediatamente anterior":** se interpretó como una acción pendiente
    concreta y vigente; si el usuario cambia de caso o la pregunta era sobre otra cosa, hace falta
    una confirmación nueva.
16. El texto del correo del cliente se entrega al modelo marcado como dato no confiable.

## 8. Cobertura

| Historia | Estado | Evidencia | Qué falta para producción |
|---|---|---|---|
| HU-1 Leer la solicitud | Hecho | `proveedor_leer_solicitud`; detecta ambiguos e identificador por país | Leer correos y adjuntos reales (Graph API / IMAP) y extraer la plantilla del Excel/PDF original. |
| HU-2 Mapear campos | Hecho | 3 estados con ruta en el maestro; glosario; umbral 0,8 | Ampliar el glosario con el uso real; dueño del dato maestro. |
| HU-3 Formulario | Hecho (xlsx P0, pdf P1) · Diseñado (portal P2) | `formulario.xlsx` en celdas exactas, `formulario.pdf`, `valores-portal.md` | Escribir sobre el Excel original del cliente (conservar formato); AcroForm si el cliente lo trae; portal según la sección 5. |
| HU-4 Paquete para firma | Hecho | `paquete/` con formulario, soportes, `checklist.md`, `borrador-correo.md`; `ENVIO-SIMULADO.md` solo tras confirmar | Integración con firma electrónica y envío real con aprobación. |
| HU-5 Errores | Hecho | Errores tipados, plantilla corrupta, caso inexistente, rutas maliciosas; tests | Monitoreo y alertas. |
| Bonus 9.4 | Hecho | `modulo/` generado desde las mismas fuentes; un test verifica que no diverja | Publicarlo en el registro de agentes de la plataforma destino. |

## 9. Uso de IA

Este reto se resolvió **íntegramente con IA**, como pedía la prueba.

| Asistente | Para qué |
|---|---|
| **Claude Code** (aplicación de escritorio, modelo Claude Opus 5.5) | Lectura y resumen del PRD y los fixtures; diseño de la arquitectura; escritura de todo el código (herramientas, ciclo, adaptador, servidor, front); pruebas automáticas; ejecución de `demo.ts`, `bun test` y `tsc`; prueba del chat en el navegador integrado; generación del PDF y verificación visual; redacción de README y SOLUCION. |

**Cómo lo usé:** primero pedí el contexto y un resumen del reto antes de resolver nada. Después di
instrucciones de alto nivel y restricciones (nunca dejar claves en el repositorio, solo datos de
prueba, hacer que las vigencias funcionen con una fecha actual). Revisé el plan y los resultados
de cada etapa.

**Revisión contra un análisis de trampas del PRD:** con la primera versión terminada, se le entregó al
asistente un análisis independiente de trampas y una matriz de pruebas, y se le pidió contrastarlo
punto por punto. Encontró seis brechas, que se corrigieron y quedaron cubiertas por
`tests/trampas.test.ts`:

1. La confirmación no estaba ligada a un caso: un "sí, envía el caso B" tras preguntar por A habría pasado.
2. Un proveedor que ignorara la cancelación podía dejar el turno esperando indefinidamente.
3. El modelo recibía la cuenta bancaria y la cédula completas.
4. El resumen no separaba "listo para firma" de "formulario completo", ni los soportes por estado.
5. El correo del cliente no se marcaba como dato no confiable.
6. Faltaban pruebas para varios escenarios de la matriz (cambio de caso, acción distinta, plantilla sin datos bancarios, orden del PDF, determinismo).

**Qué se descartó de lo propuesto y por qué:**

- Mi pedido inicial fue cambiar las fechas de vencimiento de los soportes. Se descartó editar los
  fixtures porque el PRD lo prohíbe, y se reemplazó por una fecha de referencia configurable
  (decisión 4).
- Que el modelo mapeara los campos: descartado por el riesgo de valores inventados (decisión 1).
- Usar el *tool runner* del SDK o un framework de agentes: descartado para mantener la compuerta de
  confirmación y la independencia del proveedor (decisión 5).
- Arrancar el servidor de prueba en el puerto 3000 de la configuración de vista previa: ese puerto
  ya lo usaba otra aplicación local, así que se usó otro puerto sin tocar el otro proyecto.
- Usar Claude como modelo del agente desplegado: el asistente lo propuso como opción por defecto,
  pero se descartó para no usar una clave de pago en un link público. Se le pidió agregar un
  adaptador de Gemini con capa gratuita; el de Anthropic queda como alternativa.
- Publicar `PRD.md` en el repositorio público: se excluyó por ser un documento interno del proceso
  de selección.

**Verificación:** el asistente ejecutó `bun run demo.ts`, `bun test` (92 pruebas) y `tsc`, construyó
la imagen Docker, revisó el Excel, el PDF, el checklist y el borrador de correo generados, y probó el
flujo de confirmación en el chat con el proveedor simulado. El adaptador de Gemini se probó con un cliente falso (formato de mensajes, firmas de pensamiento, reintentos y flujo completo); la prueba contra la API real de Gemini queda pendiente de tener la clave.
*(Completar por el candidato: qué revisó personalmente y la prueba con el modelo real.)*

## 10. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| El modelo "completa" un valor faltante. | Los valores solo salen del maestro vía herramientas; `generar_formulario` ignora valores del modelo; el prompt lo prohíbe; el checklist lista faltantes. |
| **Inyección de instrucciones** en el correo del cliente (el cuerpo llega al modelo). | Las acciones externas exigen confirmación en código; las herramientas no ejecutan comandos ni escriben fuera de `out/`; nombres de caso y archivos validados. En producción: marcar el contenido del correo como dato no confiable y revisar adjuntos. |
| Datos sensibles (cuenta bancaria, cédula) enviados al proveedor del modelo. | Ya implementado: se enmascaran en lo que ve el modelo y el chat. En producción, además, un acuerdo de retención de datos con el proveedor y ampliar `claves_sensibles` según la política de datos. |
| La **capa gratuita** de Gemini puede usar las solicitudes para mejorar los productos de Google y tiene límites bajos por minuto. | Aceptable para el reto porque todos los datos son ficticios. En producción: plan de pago (sin uso de datos para entrenamiento y con más cuota), o el adaptador de Anthropic, sin cambiar el ciclo. |
| Maestro o soportes desactualizados. | Nombrar un dueño del dato; alertas de "por vencer"; la fecha de referencia real en producción. |
| Plantillas reales más variadas (celdas combinadas, PDFs escaneados). | Ampliar el glosario con la telemetría de faltantes; escribir sobre el archivo original; OCR para PDFs escaneados. |
| Costo descontrolado por abuso del link. | Tope de iteraciones y tokens por sesión, límite por IP y clave de acceso opcional (`APP_ACCESS_KEY`). |
| Sesiones en memoria se pierden al reiniciar o con varias instancias. | Persistir sesiones (Redis o base de datos) y guardar `out/` en almacenamiento compartido. |
| Portales con CAPTCHA, MFA o cambios de diseño. | El humano opera login y envío; ubicación de campos por etiqueta visible (sección 5). |
