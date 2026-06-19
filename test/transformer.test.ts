import { describe, expect, it } from "vitest"
import { parseCooklang } from "../src/parser"

describe("parseCooklang", () => {
  it("parses a simple ingredient", () => {
    const result = parseCooklang("Add @salt{1%tsp} to taste.")
    const step = result.sections[0].steps[0]
    expect(step.tokens).toContainEqual(
      expect.objectContaining({
        type: "ingredient",
        ingredient: expect.objectContaining({ name: "salt", unit: "tsp" }),
      }),
    )
  })

  it("parses optional modifier @?", () => {
    const result = parseCooklang("Add @?mascarpone{250%g}.")
    const step = result.sections[0].steps[0]
    const tok = step.tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({ type: "ingredient", ingredient: { name: "mascarpone", modifier: "optional" } })
  })

  it("parses recipe modifier @@", () => {
    const result = parseCooklang("Use @@Crème pâtissière{4} as base.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({ type: "ingredient", ingredient: { modifier: "recipe" } })
  })

  it("parses cookware #", () => {
    const result = parseCooklang("Mix in #robot{}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "cookware")
    expect(tok).toMatchObject({ type: "cookware", cookware: { name: "robot" } })
  })

  it("parses a timer", () => {
    const result = parseCooklang("Cook for ~{25%minutes}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "timer")
    expect(tok).toMatchObject({ type: "timer", timer: { quantity: "25", unit: "minutes" } })
  })

  it("parses a named timer", () => {
    const result = parseCooklang("Boil ~eggs{3%minutes}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "timer")
    expect(tok).toMatchObject({ type: "timer", timer: { name: "eggs", quantity: "3", unit: "minutes" } })
  })

  it("parses wiki-links [[...]]", () => {
    const result = parseCooklang("See [[desserts/Crème pâtissière]].")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "wiki-link")
    expect(tok).toMatchObject({ type: "wiki-link", target: "desserts/Crème pâtissière", display: null })
  })

  it("parses wiki-links with display text [[target|display]]", () => {
    const result = parseCooklang("See [[desserts/foo|Crème]].")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "wiki-link")
    expect(tok).toMatchObject({ type: "wiki-link", target: "desserts/foo", display: "Crème" })
  })

  it("parses sections == ... ==", () => {
    const result = parseCooklang("== Pour la craquelin ==\n\nMix @beurre{60%g}.")
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].name).toBe("Pour la craquelin")
  })

  it("keeps pre-section steps in a null-named section", () => {
    const result = parseCooklang("Intro step.\n\n== Section ==\n\nSection step.")
    expect(result.sections).toHaveLength(2)
    expect(result.sections[0].name).toBeNull()
    expect(result.sections[1].name).toBe("Section")
  })

  it("strips inline comments --", () => {
    const result = parseCooklang("Mix well. -- this is a comment")
    const tok = result.sections[0].steps[0].tokens[0]
    expect(tok.type).toBe("text")
    if (tok.type === "text") expect(tok.value).toBe("Mix well.")
  })

  it("skips pure comment lines without flushing paragraph", () => {
    const result = parseCooklang("-- section header\nline one\nline two")
    expect(result.sections[0].steps).toHaveLength(1)
    expect(result.sections[0].steps[0].tokens.some((t) => t.type === "text" && t.value.includes("line one"))).toBe(true)
  })

  it("parses range quantity @eggs{2-4}", () => {
    const result = parseCooklang("Add @eggs{2-4}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({
      type: "ingredient",
      ingredient: { name: "eggs", quantity: { kind: "range", low: "2", high: "4" }, unit: null },
    })
  })

  it("parses range with unit @sauce{200-300%ml}", () => {
    const result = parseCooklang("Add @sauce{200-300%ml}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({
      type: "ingredient",
      ingredient: { quantity: { kind: "range", low: "200", high: "300" }, unit: "ml" },
    })
  })

  it("parses temperature in text", () => {
    const result = parseCooklang("Preheat oven to 180°C.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "temperature")
    expect(tok).toMatchObject({ type: "temperature", raw: "180°C" })
  })

  it("does not treat ~ mid-word as timer", () => {
    const result = parseCooklang("Dintérieur~=14 cm.")
    const tokens = result.sections[0].steps[0].tokens
    expect(tokens.every((t) => t.type !== "timer")).toBe(true)
  })

  it("parses preparation note from name @concombres (prep){1}", () => {
    const result = parseCooklang("Add @concombres (grossièrement pelés){1}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({
      type: "ingredient",
      ingredient: { name: "concombres", preparation: "grossièrement pelés" },
    })
  })

  it("parses alias @white wine|wine{}", () => {
    const result = parseCooklang("Add @white wine|wine{}.")
    const tok = result.sections[0].steps[0].tokens.find((t) => t.type === "ingredient")
    expect(tok).toMatchObject({
      type: "ingredient",
      ingredient: { name: "white wine", alias: "wine" },
    })
  })

  it("handles multiple steps separated by blank lines", () => {
    const result = parseCooklang("Step one.\n\nStep two.\n\nStep three.")
    expect(result.sections[0].steps).toHaveLength(3)
  })

  it("preserves intra-step line breaks as \\n text token", () => {
    const result = parseCooklang("Line one.\nLine two.")
    const tokens = result.sections[0].steps[0].tokens
    const nlTok = tokens.find((t) => t.type === "text" && t.value === "\n")
    expect(nlTok).toBeDefined()
  })
})
