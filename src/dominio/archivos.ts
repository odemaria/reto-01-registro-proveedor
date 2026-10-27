import { access, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { z } from "zod"
import { exito, fallo, mensajeDeError, type Resultado } from "./resultado"

export async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta)
    return true
  } catch {
    return false
  }
}

/**
 * Lee y valida un JSON. Distingue "no existe", "JSON corrupto" y "formato inesperado"
 * para que el mensaje al usuario sea claro (HU-5).
 */
export async function leerJson<T>(ruta: string, esquema: z.ZodType<T>, descripcion: string): Promise<Resultado<T>> {
  let texto: string
  try {
    texto = await readFile(ruta, "utf8")
  } catch (error) {
    return fallo(`No se pudo leer ${descripcion}: ${mensajeDeError(error)}.`)
  }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto.replace(/^﻿/, ""))
  } catch {
    return fallo(`${descripcion} está corrupto: no es un JSON válido.`)
  }
  const validado = esquema.safeParse(crudo)
  if (!validado.success) {
    const problema = validado.error.issues[0]
    const donde = problema && problema.path.length > 0 ? ` (en ${problema.path.join(".")})` : ""
    return fallo(`${descripcion} no tiene el formato esperado${donde}: ${problema?.message ?? "estructura inválida"}.`)
  }
  return exito(validado.data)
}

export async function escribirTexto(ruta: string, contenido: string | Uint8Array): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await writeFile(ruta, contenido)
}
