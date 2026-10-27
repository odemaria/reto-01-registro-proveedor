/** Resultado tipado: ninguna herramienta lanza excepciones hacia el agente. */
export type Exito<T> = { ok: true; data: T }
export type Fallo = { ok: false; error: string }
export type Resultado<T> = Exito<T> | Fallo

export function exito<T>(data: T): Exito<T> {
  return { ok: true, data }
}

export function fallo(error: string): Fallo {
  return { ok: false, error }
}

const MENSAJES_POR_CODIGO: Record<string, string> = {
  ENOENT: "no se encontró el archivo o la carpeta",
  EACCES: "no hay permisos para acceder al archivo",
  EPERM: "la operación no está permitida sobre el archivo",
  EBUSY: "el archivo está en uso por otro programa (¿está abierto en Excel?)",
  ENOSPC: "no hay espacio en disco",
}

/** Convierte cualquier error en una frase clara, sin trazas ni rutas absolutas. */
export function mensajeDeError(error: unknown): string {
  if (error instanceof Error) {
    const codigo = (error as NodeJS.ErrnoException).code
    if (codigo && MENSAJES_POR_CODIGO[codigo]) return MENSAJES_POR_CODIGO[codigo]
    return error.message.split("\n")[0]?.replace(/[A-Za-z]:\\[^\s'"]+|\/(?:[^\s/'"]+\/)+[^\s'"]*/g, "<ruta>") ?? "error desconocido"
  }
  return "error desconocido"
}
