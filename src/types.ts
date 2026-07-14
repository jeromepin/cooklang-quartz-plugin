import type { Node } from "unist"
import type { RootContent } from "mdast"

export type Quantity =
  | { kind: "scalar"; value: string }
  | { kind: "range"; low: string; high: string }
  | { kind: "none" }

export type IngredientModifier = "optional" | "hidden" | "reference" | "new" | "recipe" | null

export interface ParsedIngredient {
  name: string
  alias: string | null
  quantity: Quantity
  unit: string | null
  modifier: IngredientModifier
  preparation: string | null
}

export interface ParsedCookware {
  name: string
  quantity: string | null
}

export interface ParsedTimer {
  name: string | null
  quantity: string
  unit: string
}

export type ParseMode = "default" | "ingredients" | "steps" | "text"
export type DuplicateMode = "new" | "reference"

// Custom mdast leaf node types, produced by the cooklang remark plugin in place of the
// `@ingredient{}` / `#cookware{}` / `~timer{}` / temperature text they replace.
export interface CooklangIngredientNode extends Node {
  type: "cooklangIngredient"
  ingredient: ParsedIngredient
}

export interface CooklangCookwareNode extends Node {
  type: "cooklangCookware"
  cookware: ParsedCookware
}

export interface CooklangTimerNode extends Node {
  type: "cooklangTimer"
  timer: ParsedTimer
}

export interface CooklangTemperatureNode extends Node {
  type: "cooklangTemperature"
  raw: string
}

declare module "mdast" {
  interface RootContentMap {
    cooklangIngredient: CooklangIngredientNode
    cooklangCookware: CooklangCookwareNode
    cooklangTimer: CooklangTimerNode
    cooklangTemperature: CooklangTemperatureNode
  }
  interface PhrasingContentMap {
    cooklangIngredient: CooklangIngredientNode
    cooklangCookware: CooklangCookwareNode
    cooklangTimer: CooklangTimerNode
    cooklangTemperature: CooklangTemperatureNode
  }
}

// One retained top-level Markdown block (paragraph, list, table, blockquote, image,
// or any other mdast node type) that belongs to a recipe section's instructions.
// `numbered` is true only for prose paragraphs outside `[mode: text]` — every other
// block type (or a `[mode: text]` paragraph) is rendered as unnumbered supporting content.
export interface SectionBlock {
  mdastNode: RootContent
  numbered: boolean
  mode: ParseMode
}

export interface ParsedSection {
  name: string | null
  blocks: SectionBlock[]
}

export interface CooklangRecipe {
  sections: ParsedSection[]
}

// vfile augmentation — allows storing parsed recipe data in the vfile
declare module "vfile" {
  interface DataMap {
    cooklang: CooklangRecipe
  }
}

export interface CooklangTransformerOptions {
  // Reserved for future options
}
