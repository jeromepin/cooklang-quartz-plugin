import { h } from "hastscript"
import { toHast } from "mdast-util-to-hast"
import type { Handlers } from "mdast-util-to-hast"
import { visit } from "unist-util-visit"
import type { Element, ElementContent, Nodes as HastNodes } from "hast"
import type {
  CooklangCookwareNode,
  CooklangIngredientNode,
  CooklangRecipe,
  CooklangTemperatureNode,
  CooklangTimerNode,
  ParsedCookware,
  ParsedIngredient,
  ParsedSection,
  SectionBlock,
} from "./types"
import { i18n } from "./i18n/index"

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

const cooklangHandlers: Handlers = {
  cooklangIngredient(_state, node: CooklangIngredientNode) {
    return h("span", { class: "ingredient_ref" }, node.ingredient.alias ?? node.ingredient.name)
  },
  cooklangCookware(_state, node: CooklangCookwareNode) {
    return h("span", { class: "cookware_ref" }, node.cookware.name)
  },
  cooklangTimer(_state, node: CooklangTimerNode) {
    return h("span", { class: "timer_ref" }, `⏱ ${node.timer.quantity} ${node.timer.unit}`)
  },
  cooklangTemperature(_state, node: CooklangTemperatureNode) {
    return h("span", { class: "cooklang-temperature" }, node.raw)
  },
}

function convertBlockChildren(block: SectionBlock): ElementContent[] {
  const converted = toHast(block.mdastNode, { handlers: cooklangHandlers }) as HastNodes
  if (converted.type === "root") return converted.children as ElementContent[]
  return [converted as ElementContent]
}

function renderBlock(block: SectionBlock, stepNum: number | null): Element {
  const children = convertBlockChildren(block)

  if (stepNum !== null) {
    const first = children[0]
    if (first && first.type === "element") {
      first.children = [h("span", { class: "step-num" }, `${stepNum}.`), { type: "text", value: " " }, ...first.children]
    }
    return h("div", { class: "step-block" }, children)
  }

  const className = block.mode === "text" ? "step-block text-step" : "step-block"
  return h("div", { class: className }, children)
}

function renderQuantityHast(ingredient: ParsedIngredient): ElementContent | null {
  const unitEl = ingredient.unit ? h("span", { class: "unit" }, ingredient.unit) : null

  if (ingredient.quantity.kind === "scalar") {
    const valueEl = h(
      "span",
      { class: "scalable-value", "data-base": ingredient.quantity.value },
      ingredient.quantity.value,
    )
    return h("span", { class: "ing-qty" }, unitEl ? [valueEl, " ", unitEl] : [valueEl])
  }

  if (ingredient.quantity.kind === "range") {
    const rangeEl = h(
      "span",
      {
        class: "scalable-range",
        "data-base-low": ingredient.quantity.low,
        "data-base-high": ingredient.quantity.high,
      },
      `${ingredient.quantity.low}-${ingredient.quantity.high}`,
    )
    return h("span", { class: "ing-qty" }, unitEl ? [rangeEl, " ", unitEl] : [rangeEl])
  }

  return null
}

function renderIngredientLi(ingredient: ParsedIngredient, labels: ReturnType<typeof i18n>["components"]["recipe"]): Element {
  const display = ingredient.alias ?? ingredient.name
  const prepEl = ingredient.preparation
    ? [" ", h("em", { class: "ing-prep" }, `(${ingredient.preparation})`)]
    : []

  let modBadge: Element
  if (ingredient.modifier === "optional") {
    modBadge = h("span", { class: "ingredient_modifiers" }, labels.opt)
  } else if (ingredient.modifier === "recipe") {
    modBadge = h("span", { class: "ingredient_modifiers recipe-badge" }, labels.recipe)
  } else {
    modBadge = h("span", { class: "ingredient_modifiers" })
  }

  const qtyEl = renderQuantityHast(ingredient)

  return h("li", [
    h("span", [modBadge, h("span", [display, ...prepEl])]),
    ...(qtyEl ? [qtyEl] : []),
  ])
}

function collectIngredients(blocks: SectionBlock[]): ParsedIngredient[] {
  const ingredients: ParsedIngredient[] = []
  for (const block of blocks) {
    visit(block.mdastNode, "cooklangIngredient", (node: CooklangIngredientNode) => {
      const { modifier } = node.ingredient
      if (modifier === "hidden" || modifier === "reference") return
      ingredients.push(node.ingredient)
    })
  }
  return ingredients
}

function collectCookware(sections: ParsedSection[]): ParsedCookware[] {
  const seen = new Set<string>()
  const cookware: ParsedCookware[] = []
  for (const section of sections) {
    for (const block of section.blocks) {
      visit(block.mdastNode, "cooklangCookware", (node: CooklangCookwareNode) => {
        const key = node.cookware.name.toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        cookware.push(node.cookware)
      })
    }
  }
  return cookware
}

export function buildRecipeHast(
  recipe: CooklangRecipe,
  frontmatter: Record<string, unknown>,
  locale: string,
): ElementContent[] {
  const labels = i18n(locale).components.recipe

  // --- Metadata row ---
  const servings = (frontmatter["servings"] as number | undefined) ?? 1
  const prepTime = frontmatter["prep time"] as string | undefined
  const cookTime = frontmatter["cook time"] as string | undefined
  const totalTime = frontmatter["time required"] as string | undefined
  const source = frontmatter["source"] as string | undefined

  const timeChips = [
    prepTime ? { label: labels.prep, value: prepTime } : null,
    cookTime ? { label: labels.cook, value: cookTime } : null,
    totalTime ? { label: labels.total, value: totalTime } : null,
  ].filter((c): c is { label: string; value: string } => c !== null)

  const metaChildren: ElementContent[] = [
    h("div", { class: "servings-control" }, [
      h("span", labels.servings),
      h("button", { class: "servings-btn", "data-delta": "-1" }, "−"),
      h("span", { id: "servings-display", "data-base": String(servings) }, String(servings)),
      h("button", { class: "servings-btn", "data-delta": "1" }, "+"),
    ]),
  ]

  if (timeChips.length > 0) {
    metaChildren.push(
      h(
        "div",
        { class: "recipe-time-chips" },
        timeChips.map((chip) => h("span", { class: "recipe-time-chip" }, [h("span", { class: "time-label" }, chip.label), " ", chip.value])),
      ),
    )
  }

  if (source) {
    metaChildren.push(
      h("a", { href: source, class: "recipe-source", target: "_blank", rel: "noopener noreferrer" }, `${labels.source} ↗`),
    )
  }

  const metaHast = h("div", { class: "recipe-meta" }, metaChildren)

  // --- Cookware list (deduplicated globally) ---
  const allCookware = collectCookware(recipe.sections)
  const cookwareNodes: ElementContent[] = []
  if (allCookware.length > 0) {
    cookwareNodes.push(h("h2", { id: "ustensiles" }, labels.cookware))
    cookwareNodes.push(
      h(
        "ul",
        { class: "cookware-list" },
        allCookware.map((c) =>
          h("li", c.quantity ? [c.name, " ", h("span", { class: "cw-qty" }, c.quantity)] : [c.name]),
        ),
      ),
    )
  }

  // --- Ingredients section ---
  const ingredientsNodes: ElementContent[] = []
  let hasAnyIngredients = false
  for (const section of recipe.sections) {
    const ingredients = collectIngredients(section.blocks)
    if (ingredients.length === 0) continue
    hasAnyIngredients = true
    if (section.name) {
      ingredientsNodes.push(h("h3", { id: `ing-${slugify(section.name)}` }, section.name))
    }
    ingredientsNodes.push(
      h(
        "ul",
        { class: "ing-list" },
        ingredients.map((ing) => renderIngredientLi(ing, labels)),
      ),
    )
  }
  if (hasAnyIngredients) ingredientsNodes.unshift(h("h2", { id: "ingredients" }, labels.ingredients))

  // --- Instructions section ---
  const instructionsNodes: ElementContent[] = [h("h2", { id: "instructions" }, labels.instructions)]
  for (const section of recipe.sections) {
    if (section.blocks.length === 0) continue
    if (section.name) {
      instructionsNodes.push(h("h3", { id: `inst-${slugify(section.name)}` }, section.name))
    }
    let stepNum = 1
    for (const block of section.blocks) {
      const num = block.numbered ? stepNum++ : null
      instructionsNodes.push(renderBlock(block, num))
    }
  }

  return [metaHast, ...cookwareNodes, ...ingredientsNodes, ...instructionsNodes]
}
