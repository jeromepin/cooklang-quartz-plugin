import { describe, expect, it } from "vitest"
import { visit } from "unist-util-visit"
import { parseCooklangFixture, withCooklangFrontmatter as withFrontmatter } from "./helpers"
import type { CooklangRecipe } from "../src/types"

// Integration-style: run the real textTransform -> remark(gfm) -> cooklang-remark pipeline
// (via parseCooklangFixture, test/helpers.ts) and assert on the resulting file.data.cooklang
// shape. This supersedes the old unit tests against a standalone `parseCooklang(str)`
// function, which no longer exists — cooklang token extraction is now coupled to a real
// mdast tree produced by remark/GFM.
const processCooklang = parseCooklangFixture

function findAll(recipe: CooklangRecipe, type: string): unknown[] {
  const found: unknown[] = []
  for (const section of recipe.sections) {
    for (const block of section.blocks) {
      // Block body (not an implicit-return arrow) — Array#push's return value
      // (the new length) would otherwise be read by unist-util-visit as an
      // "Index" instruction and hijack the traversal.
      visit(block.mdastNode, type, (node) => {
        found.push(node)
      })
    }
  }
  return found
}

describe("cooklang pipeline — ingredients, cookware, timers", () => {
  it("parses a simple ingredient", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @salt{1%tsp} to taste."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { name: string; unit: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "salt", unit: "tsp" })
  })

  it("parses optional modifier @?", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @?mascarpone{250%g}."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("optional")
  })

  it("parses recipe modifier @@", () => {
    const { recipe } = processCooklang(withFrontmatter("Use @@Creme patissiere{4} as base."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("recipe")
  })

  it("parses cookware #", () => {
    const { recipe } = processCooklang(withFrontmatter("Mix in #robot{}."))
    const cw = findAll(recipe, "cooklangCookware")[0] as { cookware: { name: string } }
    expect(cw.cookware.name).toBe("robot")
  })

  it("parses an anonymous timer", () => {
    const { recipe } = processCooklang(withFrontmatter("Cook for ~{25%minutes}."))
    const timer = findAll(recipe, "cooklangTimer")[0] as { timer: { quantity: string; unit: string } }
    expect(timer.timer).toMatchObject({ quantity: "25", unit: "minutes" })
  })

  it("parses a named timer", () => {
    const { recipe } = processCooklang(withFrontmatter("Boil ~eggs{3%minutes}."))
    const timer = findAll(recipe, "cooklangTimer")[0] as { timer: { name: string | null; quantity: string; unit: string } }
    expect(timer.timer).toEqual({ name: "eggs", quantity: "3", unit: "minutes" })
  })

  it("does not treat ~ mid-word as a timer", () => {
    const { recipe } = processCooklang(withFrontmatter("Dintérieur~=14 cm."))
    expect(findAll(recipe, "cooklangTimer")).toHaveLength(0)
  })

  it("does not corrupt a timer via a stray unrelated tilde in the same paragraph", () => {
    const { recipe } = processCooklang(withFrontmatter("Boil ~eggs{3%minutes} - it's ~ish done by then."))
    const timer = findAll(recipe, "cooklangTimer")[0] as { timer: { name: string | null } }
    expect(timer).toBeDefined()
    expect(timer.timer.name).toBe("eggs")
  })

  it("parses two timers in the same paragraph independently", () => {
    const { recipe } = processCooklang(
      withFrontmatter("Boil ~eggs{3%minutes} then rest the ~dough{2%hours} covered."),
    )
    const timers = findAll(recipe, "cooklangTimer") as { timer: { name: string | null; quantity: string; unit: string } }[]
    expect(timers.map((t) => t.timer)).toEqual([
      { name: "eggs", quantity: "3", unit: "minutes" },
      { name: "dough", quantity: "2", unit: "hours" },
    ])
  })

  it("parses range quantity @eggs{2-4}", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @eggs{2-4}."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { quantity: unknown; unit: string | null } }
    expect(ing.ingredient).toMatchObject({ quantity: { kind: "range", low: "2", high: "4" }, unit: null })
  })

  it("parses range with unit @sauce{200-300%ml}", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @sauce{200-300%ml}."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { quantity: unknown; unit: string | null } }
    expect(ing.ingredient).toMatchObject({ quantity: { kind: "range", low: "200", high: "300" }, unit: "ml" })
  })

  it("parses temperature in text", () => {
    const { recipe } = processCooklang(withFrontmatter("Preheat oven to 180°C."))
    const temp = findAll(recipe, "cooklangTemperature")[0] as { raw: string }
    expect(temp.raw).toBe("180°C")
  })

  it("parses a preparation note with an internal dash", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @concombres (noha - moyen){1}."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { name: string; preparation: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "concombres", preparation: "noha - moyen" })
  })

  it("parses an alias @white wine|wine{}", () => {
    const { recipe } = processCooklang(withFrontmatter("Add @white wine|wine{}."))
    const ing = findAll(recipe, "cooklangIngredient")[0] as { ingredient: { name: string; alias: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "white wine", alias: "wine" })
  })

  it("passes [[wiki-links]] through untouched (delegated to Obsidian's own transformer)", () => {
    const { recipe } = processCooklang(withFrontmatter("See [[desserts/Crème pâtissière]]."))
    // No custom wiki-link node type exists anymore — this just confirms the plugin
    // doesn't choke on `[[...]]` and doesn't try to resolve it itself.
    expect(findAll(recipe, "wiki-link")).toHaveLength(0)
    expect(recipe.sections[0]?.blocks.length).toBeGreaterThan(0)
  })
})

describe("cooklang pipeline — sections and comments", () => {
  it("parses sections == ... ==", () => {
    const { recipe } = processCooklang(withFrontmatter("== Pour la craquelin ==\n\nMix @beurre{60%g}."))
    expect(recipe.sections).toHaveLength(1)
    expect(recipe.sections[0]?.name).toBe("Pour la craquelin")
  })

  it("keeps pre-section steps in a null-named section", () => {
    const { recipe } = processCooklang(withFrontmatter("Intro step.\n\n== Section ==\n\nSection step."))
    expect(recipe.sections).toHaveLength(2)
    expect(recipe.sections[0]?.name).toBeNull()
    expect(recipe.sections[1]?.name).toBe("Section")
  })

  it("restarts step numbering at 1 per section", () => {
    const { recipe } = processCooklang(
      withFrontmatter("Step one.\n\nStep two.\n\n== Section ==\n\nStep three."),
    )
    const numberedCounts = recipe.sections.map((s) => s.blocks.filter((b) => b.numbered).length)
    expect(numberedCounts).toEqual([2, 1])
  })

  it("strips inline comments --", () => {
    const { recipe } = processCooklang(withFrontmatter("Mix well. -- this is a comment"))
    const text = JSON.stringify(recipe.sections[0]?.blocks[0]?.mdastNode)
    expect(text).toContain("Mix well.")
    expect(text).not.toContain("this is a comment")
  })

  it("skips pure comment lines without flushing paragraph", () => {
    const { recipe } = processCooklang(withFrontmatter("-- section header\nline one\nline two"))
    expect(recipe.sections[0]?.blocks).toHaveLength(1)
    const text = JSON.stringify(recipe.sections[0]?.blocks[0]?.mdastNode)
    expect(text).toContain("line one")
    expect(text).toContain("line two")
  })

  it("handles multiple steps separated by blank lines", () => {
    const { recipe } = processCooklang(withFrontmatter("Step one.\n\nStep two.\n\nStep three."))
    expect(recipe.sections[0]?.blocks).toHaveLength(3)
  })
})

describe("cooklang pipeline — modes", () => {
  it("[mode: text] preserves literal cooklang syntax (no substitution)", () => {
    const { recipe } = processCooklang(withFrontmatter("[mode: text]\n\nThis is @not{an ingredient}."))
    expect(findAll(recipe, "cooklangIngredient")).toHaveLength(0)
    const block = recipe.sections[0]?.blocks[0]
    expect(block?.numbered).toBe(false)
    expect(block?.mode).toBe("text")
  })

  it("[mode: ingredients] drops paragraphs with no ingredient", () => {
    const { recipe } = processCooklang(
      withFrontmatter("[mode: ingredients]\n\nJust prose, no components.\n\n@flour{200%g}"),
    )
    expect(recipe.sections[0]?.blocks).toHaveLength(1)
    expect(findAll(recipe, "cooklangIngredient")).toHaveLength(1)
  })

  it("[mode: steps] forces ingredients to reference unless @+", () => {
    const { recipe } = processCooklang(withFrontmatter("[mode: steps]\n\nAdd @flour{} and @+sugar{}."))
    const ings = findAll(recipe, "cooklangIngredient") as { ingredient: { name: string; modifier: string } }[]
    const flour = ings.find((i) => i.ingredient.name === "flour")
    const sugar = ings.find((i) => i.ingredient.name === "sugar")
    expect(flour?.ingredient.modifier).toBe("reference")
    expect(sugar?.ingredient.modifier).toBe("new")
  })

  it("[duplicate: ref] directive is stripped with no rendering effect", () => {
    const { recipe } = processCooklang(withFrontmatter("[duplicate: ref]\n\nAdd @flour{200%g}."))
    expect(recipe.sections[0]?.blocks).toHaveLength(1)
    expect(findAll(recipe, "cooklangIngredient")).toHaveLength(1)
  })
})

describe("cooklang pipeline — markdown/GFM composition", () => {
  it("keeps a GFM table as an unnumbered instruction block", () => {
    const md = "| A | B |\n| - | - |\n| 1 | 2 |"
    const { recipe } = processCooklang(withFrontmatter(md))
    const block = recipe.sections[0]?.blocks[0]
    expect(block?.mdastNode.type).toBe("table")
    expect(block?.numbered).toBe(false)
  })

  it("renders bold formatting around an ingredient reference", () => {
    const { recipe } = processCooklang(withFrontmatter("**Add @salt{1%tsp} now**"))
    const strongNodes = findAll(recipe, "strong")
    expect(strongNodes).toHaveLength(1)
    expect(findAll(recipe, "cooklangIngredient")).toHaveLength(1)
  })

  it("preserves intra-step line breaks as hard breaks", () => {
    const { recipe } = processCooklang(withFrontmatter("Line one.\nLine two."))
    expect(findAll(recipe, "break")).toHaveLength(1)
  })
})
