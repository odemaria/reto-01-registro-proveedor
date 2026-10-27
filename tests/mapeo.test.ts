import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Glosario, Maestro } from "../src/dominio/esquemas"
import { mapearCampos } from "../src/dominio/mapeo"
import { evaluarSoportes } from "../src/dominio/soportes"
import { contieneDatosBancarios } from "../src/dominio/reportes"
import { RAIZ } from "./utilidades"

const base = join(RAIZ, "fixtures", "reto-01")
const maestro = JSON.parse(await readFile(join(base, "repositorio", "maestro.json"), "utf8")) as Maestro
const glosario = JSON.parse(await readFile(join(base, "glosario-campos.json"), "utf8")) as Glosario
const pedir = (...etiquetas: string[]) => etiquetas.map((etiqueta) => ({ etiqueta }))

describe("mapeo de campos (HU-2)", () => {
  test("los sinónimos del glosario se resuelven con la ruta del dato", () => {
    const m = mapearCampos(pedir("Nombre de la empresa", "Domicilio fiscal", "Código CIIU"), "CO", glosario, maestro)
    expect(m.llenos.map((c) => c.clave)).toEqual(["razon_social", "direccion", "ciiu_principal"])
    expect(m.llenos[0]?.ruta).toBe("repositorio/maestro.json#razon_social")
    expect(m.llenos[0]?.valor).toBe("Periferia IT Group S.A.S.")
  })

  test("ignora tildes y mayúsculas", () => {
    const m = mapearCampos(pedir("RAZON SOCIAL", "codigo postal"), "CO", glosario, maestro)
    expect(m.llenos).toHaveLength(2)
  })

  test("un campo sin fuente es faltante y nunca se inventa", () => {
    const m = mapearCampos(pedir("Número de contribuyente especial", "Referencias comerciales"), "EC", glosario, maestro)
    expect(m.faltantes.map((f) => f.etiqueta)).toEqual(["Número de contribuyente especial", "Referencias comerciales"])
    expect(m.llenos).toHaveLength(0)
    expect(m.requiere_confirmacion).toHaveLength(0)
  })

  test("RN1: NIT en Colombia se llena", () => {
    const m = mapearCampos(pedir("NIT"), "CO", glosario, maestro)
    expect(m.llenos[0]?.valor).toBe("900123456")
  })

  test.each([
    ["EC", "RUC"],
    ["PA", "RUC"],
    ["PE", "RUC"],
    ["HN", "RTN"],
  ])("RN1: en %s el identificador se llena con el NIT y queda por confirmar (%s)", (pais, esperado) => {
    const m = mapearCampos(pedir(esperado), pais, glosario, maestro)
    const campo = m.requiere_confirmacion[0]
    expect(campo?.valor).toBe("900123456")
    expect(campo?.propuesta).toBe(esperado)
    expect(campo?.nota).toBe("identificador extranjero")
    expect(campo?.se_escribe).toBe(true)
  })

  test("HU-1: 'Identificación tributaria' es ambigua y propone el equivalente del país", () => {
    const co = mapearCampos(pedir("Identificación tributaria"), "CO", glosario, maestro)
    expect(co.requiere_confirmacion[0]?.propuesta).toBe("NIT")
    const hn = mapearCampos(pedir("Identificación tributaria"), "HN", glosario, maestro)
    expect(hn.requiere_confirmacion[0]?.propuesta).toBe("RTN")
  })

  test("RN2: un dato bancario parecido pero no exacto no se llena", () => {
    const m = mapearCampos(pedir("Cuenta bancaria para pagos"), "CO", glosario, maestro)
    expect(m.llenos).toHaveLength(0)
    expect(m.requiere_confirmacion.filter((c) => c.clave.startsWith("banco."))).toHaveLength(0)
  })

  test("una clave del maestro repetida en varios contactos pide confirmación", () => {
    const m = mapearCampos(pedir("Email"), "CO", glosario, maestro)
    expect(m.llenos).toHaveLength(0)
    expect(m.requiere_confirmacion[0]?.se_escribe).toBe(false)
  })

  test("ingresos llevan nota de moneda y año sacada del maestro", () => {
    const m = mapearCampos(pedir("Ingresos anuales"), "HN", glosario, maestro)
    expect(m.llenos[0]?.valor).toBe(98000000000)
    expect(m.llenos[0]?.nota).toBe("Moneda: COP · Año: 2025")
  })
})

describe("vigencia de soportes (RN3)", () => {
  const indice = [
    { tipo: "a", archivo: "a.txt", vigencia_hasta: "2026-09-02", pais_emisor: "CO" },
    { tipo: "b", archivo: "b.txt", vigencia_hasta: "2026-09-03", pais_emisor: "CO" },
    { tipo: "c", archivo: "c.txt", vigencia_hasta: null, pais_emisor: "CO" },
    { tipo: "d", archivo: "d.txt", vigencia_hasta: "2027-01-01", pais_emisor: "CO" },
    { tipo: "e", archivo: "no-existe.txt", vigencia_hasta: null, pais_emisor: "CO" },
  ]
  const archivos = new Set(["a.txt", "b.txt", "c.txt", "d.txt"])

  test("vencido el día anterior, vigente el mismo día, ausente si no está", () => {
    const r = evaluarSoportes(["a", "b", "c", "d", "e", "z"], indice, "2026-09-03", archivos)
    expect(r.map((s) => s.estado)).toEqual(["vencido", "por_vencer", "presente", "presente", "ausente", "ausente"])
  })
})

describe("borrador de correo (RN2)", () => {
  test("detecta números de cuenta y SWIFT", () => {
    expect(contieneDatosBancarios("cuenta 03100012345", maestro)).toBe(true)
    expect(contieneDatosBancarios("swift COLOCOBM", maestro)).toBe(true)
    expect(contieneDatosBancarios("Banco: Bancolombia", maestro)).toBe(false)
  })
})
