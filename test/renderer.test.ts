import { describe, expect, it } from "vitest"
import { toHtml } from "hast-util-to-html"
import { buildRecipeHast } from "../src/renderer"
import { parseCooklangFixture, withCooklangFrontmatter } from "./helpers"

function render(body: string, frontmatter: Record<string, unknown> = {}, locale = "en"): string {
  const { recipe } = parseCooklangFixture(withCooklangFrontmatter(body))
  const nodes = buildRecipeHast(recipe, frontmatter, locale)
  return toHtml(nodes as never)
}

describe("buildRecipeHast — metadata row", () => {
  it("renders the servings control with the base count", () => {
    const html = render("Add @salt{1%tsp}.", { servings: 4 })
    expect(html).toContain('<div class="recipe-meta">')
    expect(html).toContain('<div class="servings-control">')
    expect(html).toContain('id="servings-display" data-base="4"')
    expect(html).toContain('data-delta="-1"')
    expect(html).toContain('data-delta="1"')
  })

  it("renders time chips only for present frontmatter fields", () => {
    const html = render("Add @salt{1%tsp}.", { "prep time": "10 minutes" })
    expect(html).toContain('class="recipe-time-chips"')
    expect(html).toContain('class="recipe-time-chip"')
    expect(html).toContain("10 minutes")
    expect(html).not.toContain("Cook")
  })

  it("omits the time chips row entirely when no time fields are present", () => {
    const html = render("Add @salt{1%tsp}.")
    expect(html).not.toContain("recipe-time-chips")
  })

  it("renders a source link when present", () => {
    const html = render("Add @salt{1%tsp}.", { source: "https://example.com/recipe" })
    expect(html).toContain('<a href="https://example.com/recipe" class="recipe-source"')
  })
})

describe("buildRecipeHast — cookware", () => {
  it("renders a deduplicated cookware list", () => {
    const html = render("Mix in #robot{}.\n\nUse the #robot{} again.")
    expect(html).toContain('id="ustensiles"')
    expect(html).toContain('class="cookware-list"')
    expect((html.match(/robot/g) ?? []).length).toBe(3) // one deduplicated <li>, two inline refs
  })

  it("omits the cookware section when there is no cookware", () => {
    const html = render("Add @salt{1%tsp}.")
    expect(html).not.toContain("cookware-list")
  })
})

describe("buildRecipeHast — ingredients", () => {
  it("renders a scalar quantity with data-base for client-side scaling", () => {
    const html = render("Add @salt{1%tsp}.")
    expect(html).toContain('class="ing-list"')
    expect(html).toContain('class="scalable-value" data-base="1"')
    expect(html).toContain('class="unit">tsp')
  })

  it("renders a range quantity with data-base-low/high", () => {
    const html = render("Add @eggs{2-4}.")
    expect(html).toContain('class="scalable-range" data-base-low="2" data-base-high="4"')
  })

  it("renders the optional badge", () => {
    const html = render("Add @?mascarpone{250%g}.")
    expect(html).toMatch(/class="ingredient_modifiers">OPT/)
  })

  it("renders the recipe badge", () => {
    const html = render("Use @@Filling{4} as base.")
    expect(html).toContain('class="ingredient_modifiers recipe-badge">RECIPE')
  })

  it("excludes hidden and reference ingredients from the list", () => {
    const html = render("Add @-secret{1%g} and @&secret{}.")
    const ingListMatch = html.match(/<ul class="ing-list">[\s\S]*?<\/ul>/)
    expect(ingListMatch?.[0] ?? "").not.toContain("secret")
  })

  it("renders a preparation note", () => {
    const html = render("Add @concombres (noha - moyen){1}.")
    expect(html).toContain('class="ing-prep">(noha - moyen)')
  })

  it("lists ingredients per section, with per-section h3 headings", () => {
    const html = render("== Dough ==\n\nMix @flour{200%g}.\n\n== Filling ==\n\nAdd @sugar{50%g}.")
    expect(html).toContain('id="ing-dough"')
    expect(html).toContain('id="ing-filling"')
  })
})

describe("buildRecipeHast — instructions", () => {
  it("numbers prose steps starting at 1 and restarts per section", () => {
    const html = render("Step one.\n\nStep two.\n\n== Section ==\n\nStep three.")
    const stepNums = [...html.matchAll(/class="step-num">([^<]+)</g)].map((m) => m[1])
    expect(stepNums).toEqual(["1.", "2.", "1."])
  })

  it("renders [mode: text] steps without a number, tagged text-step", () => {
    const html = render("[mode: text]\n\nJust a note.")
    expect(html).toContain('class="step-block text-step"')
    expect(html).not.toContain("step-num")
  })

  it("renders inline ingredient/cookware/timer/temperature spans in steps", () => {
    const html = render("Heat #pan{} to 180°C, add @oil{1%tbsp}, cook ~{5%minutes}.")
    expect(html).toContain('class="cookware_ref">pan')
    expect(html).toContain('class="cooklang-temperature">180°C')
    expect(html).toContain('class="ingredient_ref">oil')
    expect(html).toContain('class="timer_ref">⏱ 5 minutes')
  })

  it("preserves bold/emphasis formatting around cooklang tokens", () => {
    const html = render("**Add @salt{1%tsp} now**")
    expect(html).toMatch(/<strong>.*ingredient_ref.*<\/strong>/)
  })

  it("renders a GFM table as instruction content without a step number", () => {
    const html = render("| A | B |\n| - | - |\n| 1 | 2 |")
    expect(html).toContain("<table>")
    const instructionsIdx = html.indexOf('id="instructions"')
    const tableIdx = html.indexOf("<table>")
    expect(tableIdx).toBeGreaterThan(instructionsIdx)
  })
})

describe("buildRecipeHast — i18n", () => {
  it("uses French labels when locale is fr", () => {
    const html = render("Add @sel{1%g}.", {}, "fr")
    expect(html).toContain(">Ingrédients<")
    expect(html).toContain(">Instructions<")
  })

  it("defaults to English labels", () => {
    const html = render("Add @salt{1%g}.", {}, "en")
    expect(html).toContain(">Ingredients<")
  })
})
