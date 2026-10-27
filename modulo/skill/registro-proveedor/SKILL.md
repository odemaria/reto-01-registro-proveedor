---
name: registro-proveedor
description: Conocimiento del proceso de registro como proveedor de Periferia IT Group — estados de campos, identificador tributario por país, datos bancarios, vigencia de soportes y formatos de salida.
---

<!-- Generado por scripts/construir-modulo.ts. No editar: modifica la fuente y ejecuta `bun run modulo`. -->

# Proceso: registro de Periferia IT Group como proveedor

Conocimiento del proceso que el agente consulta. Las reglas numéricas y tablas que usan las
herramientas viven en `src/knowledge/reglas.json`; este documento explica el porqué.

## Flujo estándar de un caso

1. **Leer la solicitud** (`proveedor_leer_solicitud`): país del cliente, formato de salida
   (`xlsx`, `pdf` o `portal`), campos de la plantilla y soportes exigidos.
2. **Mapear campos** (`proveedor_mapear_campos`): cada campo termina en `lleno`, `faltante`
   o `requiere_confirmacion`.
3. **Generar el formulario** (`proveedor_generar_formulario`) en el formato del cliente.
4. **Armar el paquete para firma** (`proveedor_armar_paquete`): formulario, soportes vigentes,
   `checklist.md` y `borrador-correo.md`.
5. **Pedir confirmación** a la analista. Solo con un "sí" explícito en el mensaje siguiente se
   ejecuta `proveedor_simular_envio`, que escribe `ENVIO-SIMULADO.md`. Nada se envía de verdad.

## Estados de un campo

| Estado | Cuándo | Qué hace la analista |
|---|---|---|
| `lleno` | El dato existe en el maestro y el mapeo es seguro (glosario o confianza ≥ 0.8). | Nada. |
| `requiere_confirmacion` | Regla de país (identificador extranjero), etiqueta ambigua o mapeo con confianza < 0.8. | Revisar y confirmar. |
| `faltante` | No existe fuente en el maestro. **Nunca se inventa.** | Conseguir el dato con el área dueña. |

## Identificador tributario por país (RN1)

| País | Identificador | Qué hacemos |
|---|---|---|
| Colombia (CO) | NIT | Se llena con el NIT del maestro. |
| Ecuador (EC) | RUC | Se llena con el NIT colombiano y queda `requiere_confirmacion` ("identificador extranjero"). |
| Perú (PE) | RUC | Igual que Ecuador. |
| Panamá (PA) | RUC | Igual que Ecuador. |
| Honduras (HN) | RTN | Igual que Ecuador. |

Periferia solo tiene NIT colombiano. Etiquetas genéricas como "Identificación tributaria" son
ambiguas: se proponen con el nombre del identificador del país del cliente y quedan por confirmar.

## Datos bancarios (RN2)

- Se llenan solo si la plantilla los pide explícitamente y con coincidencia exacta de etiqueta.
- **Nunca** van en el borrador de correo.
- En el chat no se repiten completos: basta decir "datos bancarios llenos".

## Soportes (RN3)

| Soporte | Descripción |
|---|---|
| `camara_comercio` | Certificado de existencia y representación legal. Algunos clientes exigen que no supere 30 días. |
| `rut` | Registro Único Tributario. No vence. |
| `certificacion_bancaria` | Certificación de la cuenta bancaria. |
| `parafiscales` | Pago de aportes parafiscales y seguridad social, firmado por revisor fiscal. |
| `estados_financieros` | Estados financieros auditados del último año. |
| `certificado_cumplimiento_tributario` | No existe en el repositorio de Periferia: hay que tramitarlo. |
| `certificado_iso_9001` | Certificación de calidad. |

- Un soporte con `vigencia_hasta` anterior a la fecha de referencia está **vencido**: bloquea
  `listo_para_firma` y no se copia al paquete.
- Un soporte exigido que no existe en el repositorio está **ausente**: también bloquea.
- Un soporte que vence en los próximos 15 días se marca **por vencer** (no bloquea).
- Un campo `faltante` **no** bloquea, pero aparece en el checklist.
- Todos los soportes de Periferia los emite Colombia. Para clientes de otros países se advierte
  que pueden pedir apostilla o traducción.

## Formatos de salida

| Formato | Resultado |
|---|---|
| `xlsx` | `out/<caso>/formulario.xlsx`, etiqueta y valor en la hoja y celda exactas de la plantilla. |
| `pdf` | `out/<caso>/formulario.pdf`, todos los campos con etiqueta y valor en el orden dado. |
| `portal` | No soportado. Se genera `out/<caso>/valores-portal.md` para copiar y pegar. Las credenciales y el clic en "Enviar" son siempre humanos. |

## Lo que el agente nunca hace

- Firmar, enviar correos ni cargar información en portales.
- Pedir, recibir o guardar contraseñas de portales.
- Afirmar un valor que no haya salido de una herramienta.
