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

export type StepToken =
  | { type: "text"; value: string }
  | { type: "ingredient"; ingredient: ParsedIngredient }
  | { type: "cookware"; cookware: ParsedCookware }
  | { type: "timer"; timer: ParsedTimer }
  | { type: "wiki-link"; target: string; display: string | null }
  | { type: "temperature"; raw: string }

export interface ParsedStep {
  tokens: StepToken[]
  isText: boolean
}

export interface ParsedSection {
  name: string | null
  steps: ParsedStep[]
}

export type ParseMode = "default" | "ingredients" | "steps" | "text"
export type DuplicateMode = "new" | "reference"

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
