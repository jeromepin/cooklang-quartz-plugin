import type { PluggableList, Plugin } from "unified"
import type { Root as MdastRoot, RootContent } from "mdast"
import type { Root as HastRoot } from "hast"
import type { VFile } from "vfile"
import type { QuartzTransformerPlugin, BuildCtx } from "@quartz-community/types"
import { toString } from "mdast-util-to-string"
import { visit } from "unist-util-visit"
import type { CooklangTransformerOptions, ParseMode, ParsedSection } from "./types"
import { parseDuplicateDirective, parseModeDirective } from "./parser"
import { cooklangTextTransform, decodeSectionSentinelMatch, SECTION_SENTINEL_RE } from "./textTransform"
import {
  convertSoftBreaksToHardBreaks,
  substituteIngredientsAndCookware,
  substituteTemperature,
  substituteTimerSentinels,
} from "./mdastSubstitutions"
import { buildRecipeHast } from "./renderer"
import recipeStyle from "./components/styles/recipe.scss"
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – .inline.ts imports are resolved to strings by tsup
import recipeScript from "./components/scripts/recipe.inline.ts"

function hasDescendantOfType(node: RootContent, type: string): boolean {
  let found = false
  visit(node, (n) => {
    if (n.type === type) found = true
  })
  return found
}

function isCooklangFile(file: VFile): boolean {
  const fm = (file.data?.frontmatter ?? {}) as Record<string, unknown>
  return fm["format"] === "cooklang"
}

export const CooklangTransformer: QuartzTransformerPlugin<Partial<CooklangTransformerOptions>> = (
  _opts?: Partial<CooklangTransformerOptions>,
) => {
  return {
    name: "CooklangTransformer",

    // Runs on the raw source string, before Markdown parsing. Neutralizes the two
    // cooklang constructs that would otherwise collide with GFM/Obsidian syntax
    // (`== Section ==` vs `==highlight==`, `~timer{}` vs `~~strikethrough~~`) and
    // strips comments — see textTransform.ts for the full rationale.
    textTransform(_ctx: BuildCtx, src: string): string {
      return cooklangTextTransform(src)
    },

    // Must run after Quartz's GitHubFlavoredMarkdown/ObsidianFlavoredMarkdown transformers
    // (register CooklangTransformer after them in quartz.config.ts) so tables, footnotes,
    // task lists, wiki-links/embeds, etc. are already parsed into mdast before this runs.
    markdownPlugins(_ctx: BuildCtx): PluggableList {
      const cooklangRemark: Plugin<[], MdastRoot> = () => (tree: MdastRoot, file: VFile) => {
        if (!isCooklangFile(file)) return

        const sections: ParsedSection[] = [{ name: null, blocks: [] }]
        let mode: ParseMode = "default"

        for (const node of tree.children) {
          if (node.type === "paragraph") {
            const text = toString(node)

            const sectionMatch = text.match(SECTION_SENTINEL_RE)
            if (sectionMatch) {
              sections.push({ name: decodeSectionSentinelMatch(sectionMatch), blocks: [] })
              continue
            }

            const newMode = parseModeDirective(text)
            if (newMode !== null) {
              mode = newMode
              continue
            }

            if (parseDuplicateDirective(text) !== null) continue
          }

          if (mode !== "text") {
            substituteIngredientsAndCookware(node, mode)
            substituteTemperature(node)
            substituteTimerSentinels(node)
          }
          convertSoftBreaksToHardBreaks(node)

          if (mode === "ingredients" && node.type === "paragraph" && !hasDescendantOfType(node, "cooklangIngredient")) {
            continue
          }

          const numbered = node.type === "paragraph" && mode !== "text"
          sections.at(-1)!.blocks.push({ mdastNode: node, numbered, mode })
        }

        // Drop the empty pre-amble section if the recipe starts with a section header.
        if (sections[0]?.name === null && sections[0].blocks.length === 0 && sections.length > 1) {
          sections.shift()
        }

        file.data.cooklang = { sections }
        tree.children = []
      }
      return [cooklangRemark]
    },

    htmlPlugins(_ctx: BuildCtx): PluggableList {
      const cooklangRehype: Plugin<[], HastRoot> = () => (tree: HastRoot, file: VFile) => {
        if (!file.data?.cooklang) return

        const fm = (file.data?.frontmatter ?? {}) as Record<string, unknown>
        const locale = (fm["locale"] as string | undefined) ?? "en"

        tree.children = buildRecipeHast(file.data.cooklang, fm, locale)
      }
      return [cooklangRehype]
    },

    externalResources() {
      return {
        css: [{ content: recipeStyle as string, inline: true }],
        js: [
          {
            contentType: "inline",
            loadTime: "afterDOMReady",
            script: recipeScript as string,
          },
        ],
      }
    },
  }
}
