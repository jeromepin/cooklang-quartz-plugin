import { describe, expect, it } from "vitest"
import { parseQuantity, extractNameParts, parseModeDirective, parseDuplicateDirective, TEMP_RE } from "../src/parser"

describe("parseQuantity", () => {
  it("parses a scalar with unit", () => {
    expect(parseQuantity("1%tsp")).toEqual({ quantity: { kind: "scalar", value: "1" }, unit: "tsp" })
  })

  it("parses a range with unit", () => {
    expect(parseQuantity("200-300%ml")).toEqual({
      quantity: { kind: "range", low: "200", high: "300" },
      unit: "ml",
    })
  })

  it("parses a range without unit", () => {
    expect(parseQuantity("2-4")).toEqual({ quantity: { kind: "range", low: "2", high: "4" }, unit: null })
  })

  it("parses space-separated advanced units", () => {
    expect(parseQuantity("1 L")).toEqual({ quantity: { kind: "scalar", value: "1" }, unit: "L" })
  })

  it("parses empty content as none", () => {
    expect(parseQuantity("")).toEqual({ quantity: { kind: "none" }, unit: null })
  })

  it("parses a scalar without unit", () => {
    expect(parseQuantity("4")).toEqual({ quantity: { kind: "scalar", value: "4" }, unit: null })
  })
})

describe("extractNameParts", () => {
  it("extracts an alias", () => {
    expect(extractNameParts("white wine|wine")).toEqual({
      name: "white wine",
      alias: "wine",
      preparation: null,
    })
  })

  it("extracts a preparation note with an internal dash", () => {
    expect(extractNameParts("concombres (noha - moyen)")).toEqual({
      name: "concombres",
      alias: null,
      preparation: "noha - moyen",
    })
  })

  it("handles a plain name with no alias or preparation", () => {
    expect(extractNameParts("salt")).toEqual({ name: "salt", alias: null, preparation: null })
  })
})

describe("parseModeDirective", () => {
  it("parses [mode: text]", () => {
    expect(parseModeDirective("[mode: text]")).toBe("text")
  })

  it("normalizes [mode: all] to default", () => {
    expect(parseModeDirective("[mode: all]")).toBe("default")
  })

  it("returns null for non-directive text", () => {
    expect(parseModeDirective("Mix well.")).toBeNull()
  })
})

describe("parseDuplicateDirective", () => {
  it("parses [duplicate: ref] as reference", () => {
    expect(parseDuplicateDirective("[duplicate: ref]")).toBe("reference")
  })

  it("parses [duplicate: new]", () => {
    expect(parseDuplicateDirective("[duplicate: new]")).toBe("new")
  })

  it("returns null for non-directive text", () => {
    expect(parseDuplicateDirective("Mix well.")).toBeNull()
  })
})

describe("TEMP_RE", () => {
  it("matches a temperature in prose", () => {
    TEMP_RE.lastIndex = 0
    const match = TEMP_RE.exec("Preheat oven to 180°C.")
    expect(match?.[0]).toBe("180°C")
  })
})
