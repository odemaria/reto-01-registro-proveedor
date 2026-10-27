import { join, relative, sep } from "node:path"
import type { ContextoHerramienta } from "./contexto"
import { exito, fallo, type Resultado } from "./resultado"

const PATRON_CASO = /^[a-z0-9][a-z0-9-]{0,63}$/

export type Rutas = {
  raiz: string
  fixtures: string
  casos: string
  maestro: string
  glosario: string
  soportes: string
  indiceSoportes: string
  out: string
}

export function rutasDe(ctx: ContextoHerramienta): Rutas {
  const raiz = ctx.directory
  const fixtures = join(raiz, "fixtures", "reto-01")
  const repositorio = join(fixtures, "repositorio")
  return {
    raiz,
    fixtures,
    casos: join(fixtures, "casos"),
    maestro: join(repositorio, "maestro.json"),
    glosario: join(fixtures, "glosario-campos.json"),
    soportes: join(repositorio, "soportes"),
    indiceSoportes: join(repositorio, "soportes", "index.json"),
    out: join(raiz, "out"),
  }
}

/** Evita rutas arbitrarias: el caso es un nombre de carpeta simple (sin "..", "/" ni "\"). */
export function validarNombreCaso(caso: string): Resultado<string> {
  const limpio = caso.trim()
  if (!PATRON_CASO.test(limpio)) {
    return fallo(`"${caso}" no es un nombre de caso válido: usa solo minúsculas, números y guiones (ej. "co-industrias-delta").`)
  }
  return exito(limpio)
}

export function carpetaCaso(ctx: ContextoHerramienta, caso: string): string {
  return join(rutasDe(ctx).casos, caso)
}

export function salidaCaso(ctx: ContextoHerramienta, caso: string): string {
  return join(rutasDe(ctx).out, caso)
}

/** Ruta relativa a la raíz del proyecto con "/" (nunca se expone la ruta absoluta). */
export function relativa(ctx: ContextoHerramienta, ruta: string): string {
  return relative(ctx.directory, ruta).split(sep).join("/")
}
