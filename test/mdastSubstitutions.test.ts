import { describe, expect, it } from "vitest"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import type { Root, RootContent } from "mdast"
import {
  substituteIngredientsAndCookware,
  substituteTemperature,
  substituteTimerSentinels,
  convertSoftBreaksToHardBreaks,
} from "../src/mdastSubstitutions"
import { cooklangTextTransform } from "../src/textTransform"

function parseMarkdown(md: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as Root
}

function firstParagraph(md: string): RootContent {
  const tree = parseMarkdown(md)
  const node = tree.children[0]
  if (!node) throw new Error("no nodes parsed")
  return node
}

function findNode(node: RootContent, type: string): unknown {
  if ((node as { type: string }).type === type) return node
  const children = (node as { children?: RootContent[] }).children
  if (!children) return undefined
  for (const child of children) {
    const found = findNode(child, type)
    if (found) return found
  }
  return undefined
}

// `#cookware` markers are only inserted by cooklangTextTransform's raw-text pass (see the
// Obsidian #tag collision noted there), so cookware fixtures must go through it before
// being parsed, unlike @ingredient which needs no raw-text preprocessing.
function firstParagraphWithCookwareMarked(body: string): RootContent {
  const src = `---\nformat: cooklang\ntitle: t\n---\n${body}`
  const transformed = cooklangTextTransform(src)
  const markedBody = transformed.split("---\n").pop() ?? ""
  return firstParagraph(markedBody.trim())
}

describe("substituteIngredientsAndCookware", () => {
  it("parses a simple ingredient", () => {
    const node = firstParagraph("Add @salt{1%tsp} to taste.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { name: string; unit: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "salt", unit: "tsp" })
  })

  it("parses the optional modifier", () => {
    const node = firstParagraph("Add @?mascarpone{250%g}.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("optional")
  })

  it("parses the recipe modifier", () => {
    const node = firstParagraph("Use @@Creme patissiere{4} as base.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("recipe")
  })

  it("parses cookware", () => {
    const node = firstParagraphWithCookwareMarked("Mix in #robot{}.")
    substituteIngredientsAndCookware(node, "default")
    const cw = findNode(node, "cooklangCookware") as { cookware: { name: string } }
    expect(cw.cookware.name).toBe("robot")
  })

  it("parses a multi-word cookware name (regression: Obsidian #tag collision)", () => {
    // `#poche à douille{}` was previously swallowed by Obsidian's inline #tag syntax
    // (which runs before this plugin) since the raw `#` wasn't disambiguated.
    const node = firstParagraphWithCookwareMarked("Verser dans une #poche à douille{}.")
    substituteIngredientsAndCookware(node, "default")
    const cw = findNode(node, "cooklangCookware") as { cookware: { name: string } }
    expect(cw.cookware.name).toBe("poche à douille")
  })

  it("parses bare cookware with no braces (regression: Obsidian #tag collision)", () => {
    const node = firstParagraphWithCookwareMarked("Preheat the #four{}.")
    substituteIngredientsAndCookware(node, "default")
    const cw = findNode(node, "cooklangCookware") as { cookware: { name: string } }
    expect(cw.cookware.name).toBe("four")
  })

  it("parses an alias", () => {
    const node = firstParagraph("Add @white wine|wine{}.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { name: string; alias: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "white wine", alias: "wine" })
  })

  it("parses a preparation note containing a dash", () => {
    const node = firstParagraph("Add @concombres (noha - moyen){1}.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { name: string; preparation: string | null } }
    expect(ing.ingredient).toMatchObject({ name: "concombres", preparation: "noha - moyen" })
  })

  it("parses a range quantity", () => {
    const node = firstParagraph("Add @eggs{2-4}.")
    substituteIngredientsAndCookware(node, "default")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { quantity: unknown } }
    expect(ing.ingredient.quantity).toEqual({ kind: "range", low: "2", high: "4" })
  })

  it("forces reference modifier in steps mode unless @+", () => {
    const node = firstParagraph("Add @flour{}.")
    substituteIngredientsAndCookware(node, "steps")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("reference")
  })

  it("respects @+ (new) even in steps mode", () => {
    const node = firstParagraph("Add @+flour{}.")
    substituteIngredientsAndCookware(node, "steps")
    const ing = findNode(node, "cooklangIngredient") as { ingredient: { modifier: string } }
    expect(ing.ingredient.modifier).toBe("new")
  })

  it("composes with bold formatting around the ingredient", () => {
    const node = firstParagraph("**Add @salt{1%tsp} now**")
    substituteIngredientsAndCookware(node, "default")
    const strong = findNode(node, "strong") as { children: RootContent[] }
    expect(strong).toBeDefined()
    const ing = findNode(strong as unknown as RootContent, "cooklangIngredient") as {
      ingredient: { name: string }
    }
    expect(ing.ingredient.name).toBe("salt")
  })
})

describe("substituteTemperature", () => {
  it("detects a temperature in prose", () => {
    const node = firstParagraph("Preheat oven to 180C.".replace("180C", "180°C"))
    substituteTemperature(node)
    const temp = findNode(node, "cooklangTemperature") as { raw: string }
    expect(temp.raw).toBe("180°C")
  })
})

describe("substituteTimerSentinels", () => {
  it("decodes a named timer sentinel encoded by textTransform", () => {
    const src = "---\nformat: cooklang\ntitle: t\n---\nBoil ~eggs{3%minutes}."
    const transformed = cooklangTextTransform(src)
    const body = transformed.split("---\n").pop() ?? ""
    const node = firstParagraph(body.trim())
    substituteTimerSentinels(node)
    const timer = findNode(node, "cooklangTimer") as { timer: { name: string | null; quantity: string; unit: string } }
    expect(timer.timer).toEqual({ name: "eggs", quantity: "3", unit: "minutes" })
  })

  it("decodes an anonymous timer sentinel", () => {
    const src = "---\nformat: cooklang\ntitle: t\n---\nCook for ~{25%minutes}."
    const transformed = cooklangTextTransform(src)
    const body = transformed.split("---\n").pop() ?? ""
    const node = firstParagraph(body.trim())
    substituteTimerSentinels(node)
    const timer = findNode(node, "cooklangTimer") as { timer: { name: string | null; quantity: string; unit: string } }
    expect(timer.timer).toEqual({ name: null, quantity: "25", unit: "minutes" })
  })
})

describe("convertSoftBreaksToHardBreaks", () => {
  it("converts an intra-paragraph soft break into a break node", () => {
    const node = firstParagraph("Line one.\nLine two.")
    convertSoftBreaksToHardBreaks(node)
    const brk = findNode(node, "break")
    expect(brk).toBeDefined()
  })
})
