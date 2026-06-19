import type { PluggableList, Plugin } from "unified"
import type { Root as MdastRoot } from "mdast"
import type { Root as HastRoot } from "hast"
import type { VFile } from "vfile"
import type { QuartzTransformerPlugin, BuildCtx } from "@quartz-community/types"
import type { CooklangTransformerOptions } from "./types"
import { parseCooklang } from "./parser"
import { buildRecipeHTML } from "./renderer"
import { fromHtml } from "hast-util-from-html"
import recipeStyle from "./components/styles/recipe.scss"
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – .inline.ts imports are resolved to strings by tsup
import recipeScript from "./components/scripts/recipe.inline.ts"

export const CooklangTransformer: QuartzTransformerPlugin<Partial<CooklangTransformerOptions>> = (
  _opts?: Partial<CooklangTransformerOptions>,
) => {
  return {
    name: "CooklangTransformer",

    markdownPlugins(_ctx: BuildCtx): PluggableList {
      const cooklangRemark: Plugin<[], MdastRoot> = () => (tree: MdastRoot, file: VFile) => {
        const fm = (file.data?.frontmatter ?? {}) as Record<string, unknown>
        if (fm["format"] !== "cooklang") return

        // Strip frontmatter from raw source, then parse CookLang
        const raw = String(file.value).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
        file.data.cooklang = parseCooklang(raw)

        // Clear the Markdown AST — the rehype plugin owns all output for this file
        tree.children = []
      }
      return [cooklangRemark]
    },

    htmlPlugins(ctx: BuildCtx): PluggableList {
      const cooklangRehype: Plugin<[], HastRoot> = () => (tree: HastRoot, file: VFile) => {
        if (!file.data?.cooklang) return

        const fm = (file.data?.frontmatter ?? {}) as Record<string, unknown>
        const locale = (fm["locale"] as string | undefined) ?? "en"
        const slugs = ctx.allSlugs as unknown as string[]

        const html = buildRecipeHTML(file.data.cooklang, fm, locale, slugs)
        const fragment = fromHtml(html, { fragment: true })
        tree.children = fragment.children as HastRoot["children"]
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
