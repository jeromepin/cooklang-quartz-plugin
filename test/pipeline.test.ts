import { describe, expect, it } from "vitest"
import { toHtml } from "hast-util-to-html"
import { buildRecipeHast } from "../src/renderer"
import { withCooklangFrontmatter, renderCooklangFixture } from "./helpers"
import type { CooklangRecipe } from "../src/types"

function renderHtml(body: string, frontmatter: Record<string, unknown> = {}): string {
  const tree = renderCooklangFixture(withCooklangFrontmatter(body), frontmatter)
  return toHtml(tree as never)
}

describe("full pipeline — realistic multi-section recipe", () => {
  const recipe = `
[mode: default]

== Pâte ==

Mix @crème liquide 30%+{130%g} with @white wine|wine{2-4%cl} and @concombres (noha - moyen){1}.

Preheat the #four{} to 180°C for ~cuisson{25%minutes}.

-- Pour la crème pâtissière
**12h plus tard**, unmold.

== Garniture ==

[mode: text]

Just a note about presentation, no @components{parsed} here.

[mode: default]

See [[desserts/Crème pâtissière]] for the base.
`

  it("renders end to end without throwing and produces the expected sections", () => {
    const html = renderHtml(recipe, { servings: 6, locale: "en", source: "https://example.com" })

    expect(html).toContain('id="ingredients"')
    expect(html).toContain('id="ing-pate"')
    // "Garniture" has no @ingredient tokens (its content is [mode: text] prose), so it
    // correctly gets no ingredient sub-heading — matches today's "skip empty sections" rule.
    expect(html).not.toContain('id="ing-garniture"')
    expect(html).toContain('id="instructions"')
    expect(html).toContain('id="inst-pate"')
    expect(html).toContain('id="inst-garniture"')
  })

  it("preserves literal % and + characters in an ingredient name", () => {
    const html = renderHtml(recipe)
    expect(html).toContain("crème liquide 30%+")
  })

  it("resolves the alias for display while keeping the full name internally", () => {
    const html = renderHtml(recipe)
    expect(html).toContain('class="ingredient_ref">wine')
  })

  it("renders the preparation note with its internal dash intact", () => {
    const html = renderHtml(recipe)
    expect(html).toContain("(noha - moyen)")
  })

  it("renders the temperature and timer inline", () => {
    const html = renderHtml(recipe)
    expect(html).toContain('class="cooklang-temperature">180°C')
    expect(html).toContain('class="timer_ref">⏱ 25 minutes')
  })

  it("does not flush the paragraph on a standalone comment line", () => {
    const html = renderHtml(recipe)
    expect(html).toContain("<strong>12h plus tard</strong>")
    expect(html).not.toContain("Pour la crème pâtissière")
  })

  it("keeps [mode: text] prose literal and unnumbered", () => {
    const html = renderHtml(recipe)
    expect(html).toContain("@components{parsed}")
    expect(html).toContain('class="step-block text-step"')
  })

  it("passes the wiki-link through untouched (delegated to Obsidian's own transformer)", () => {
    const html = renderHtml(recipe)
    expect(html).toContain("[[desserts/Crème pâtissière]]")
  })

  it("applies the requested servings and source link", () => {
    const html = renderHtml(recipe, { servings: 6, source: "https://example.com" })
    expect(html).toContain('data-base="6"')
    expect(html).toContain('href="https://example.com"')
  })
})

describe("full pipeline — cookware regression (Obsidian #tag collision)", () => {
  // Reported bug: cookware like `#poche à douille{}` / `#four{}` rendered as raw literal
  // text instead of a styled reference. Root cause: CooklangTransformer runs after
  // ObsidianFlavoredMarkdown (required so tables/wikilinks/etc. work), and Obsidian's own
  // inline #tag syntax would consume an un-marked `#` before this plugin ever saw it.
  it("renders multi-word and bare-word cookware as inline refs, not raw text", () => {
    const html = renderHtml("Preheat the #four{} and fill the #poche à douille{}.")
    expect(html).toContain('class="cookware_ref">four')
    expect(html).toContain('class="cookware_ref">poche à douille')
    expect(html).not.toContain("#four")
    expect(html).not.toContain("#poche")
  })

  it("still parses cookware normally when it starts a step", () => {
    const html = renderHtml("#four{} preheated to 200°C.")
    expect(html).toContain('class="cookware_ref">four')
  })
})

describe("full pipeline — resilience to unrecognized upstream node types", () => {
  it("degrades gracefully (generic wrapper, no crash) for an unhandled mdast node type", () => {
    // Simulates a node type mdast-util-to-hast has no explicit handler for (e.g. a
    // hypothetical Obsidian callout) reaching a retained instruction block. Per
    // mdast-util-to-hast's documented default, a childful unknown node is wrapped in a
    // generic element rather than throwing.
    const recipe: CooklangRecipe = {
      sections: [
        {
          name: null,
          blocks: [
            {
              mdastNode: {
                type: "unknownCalloutNode",
                children: [{ type: "text", value: "important note" }],
              } as never,
              numbered: false,
              mode: "default",
            },
          ],
        },
      ],
    }

    expect(() => buildRecipeHast(recipe, {}, "en")).not.toThrow()
    const html = toHtml(buildRecipeHast(recipe, {}, "en") as never)
    expect(html).toContain("important note")
  })
})
