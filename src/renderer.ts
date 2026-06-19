import type { CooklangRecipe, ParsedIngredient, ParsedSection, StepToken } from "./types"
import { i18n } from "./i18n/index"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

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

function renderInlineText(text: string): string {
  let result = escapeHtml(text)
  result = result
    .replace(/~~([\s\S]+?)~~/g, "<del>$1</del>")
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/_([^_\n]+?)_/g, "<em>$1</em>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br/>")
  return result
}

function resolveWikiLink(target: string, allSlugs: readonly string[]): string {
  const normalized = target.replace(/^\.?\//, "").trim()
  const lower = normalized.toLowerCase()

  const exact = allSlugs.find((s) => s.toLowerCase() === lower)
  if (exact) return `/${exact}`

  const targetFile = lower.split("/").pop() ?? lower
  const byFile = allSlugs.find((s) => {
    const parts = s.toLowerCase().split("/")
    return parts[parts.length - 1] === targetFile
  })
  if (byFile) return `/${byFile}`

  return `/${normalized}`
}

function wikiLinkDisplay(target: string): string {
  const parts = target.split("/")
  return (parts[parts.length - 1] ?? target).replace(/-/g, " ")
}

function renderTokens(tokens: StepToken[], allSlugs: readonly string[]): string {
  return tokens
    .map((tok) => {
      switch (tok.type) {
        case "text":
          return renderInlineText(tok.value)

        case "ingredient": {
          const display = escapeHtml(tok.ingredient.alias ?? tok.ingredient.name)
          return `<span class="ingredient_ref">${display}</span>`
        }

        case "cookware":
          return `<span class="cookware_ref">${escapeHtml(tok.cookware.name)}</span>`

        case "timer":
          return `<span class="timer_ref">⏱ ${escapeHtml(tok.timer.quantity)} ${escapeHtml(tok.timer.unit)}</span>`

        case "wiki-link": {
          const href = resolveWikiLink(tok.target, allSlugs)
          const display = escapeHtml(tok.display ?? wikiLinkDisplay(tok.target))
          return `<a href="${escapeHtml(href)}" class="internal">${display}</a>`
        }

        case "temperature":
          return `<span class="cooklang-temperature">${escapeHtml(tok.raw)}</span>`

        default:
          return ""
      }
    })
    .join("")
}

function renderIngredientList(section: ParsedSection, labels: ReturnType<typeof i18n>["components"]["recipe"]): string {
  const ingredients: ParsedIngredient[] = []

  for (const step of section.steps) {
    for (const tok of step.tokens) {
      if (tok.type !== "ingredient") continue
      const { modifier } = tok.ingredient
      if (modifier === "hidden" || modifier === "reference") continue
      ingredients.push(tok.ingredient)
    }
  }

  if (ingredients.length === 0) return ""

  const items = ingredients
    .map((ing) => {
      const display = escapeHtml(ing.alias ?? ing.name)
      const prepHtml = ing.preparation
        ? ` <em class="ing-prep">(${escapeHtml(ing.preparation)})</em>`
        : ""

      let modBadge = `<span class="ingredient_modifiers"></span>`
      if (ing.modifier === "optional") {
        modBadge = `<span class="ingredient_modifiers">${labels.opt}</span>`
      } else if (ing.modifier === "recipe") {
        modBadge = `<span class="ingredient_modifiers recipe-badge">${labels.recipe}</span>`
      }

      let qtyHtml = ""
      if (ing.quantity.kind === "scalar") {
        const unit = ing.unit ? `<span class="unit">${escapeHtml(ing.unit)}</span>` : ""
        qtyHtml = `<span class="ing-qty"><span class="scalable-value" data-base="${escapeHtml(ing.quantity.value)}">${escapeHtml(ing.quantity.value)}</span>${unit ? " " + unit : ""}</span>`
      } else if (ing.quantity.kind === "range") {
        const unit = ing.unit ? `<span class="unit">${escapeHtml(ing.unit)}</span>` : ""
        qtyHtml = `<span class="ing-qty"><span class="scalable-range" data-base-low="${escapeHtml(ing.quantity.low)}" data-base-high="${escapeHtml(ing.quantity.high)}">${escapeHtml(ing.quantity.low)}-${escapeHtml(ing.quantity.high)}</span>${unit ? " " + unit : ""}</span>`
      }

      return `<li><span>${modBadge}<span>${display}${prepHtml}</span></span>${qtyHtml}</li>`
    })
    .join("\n")

  return `<ul class="ing-list">\n${items}\n</ul>`
}

export function buildRecipeHTML(
  recipe: CooklangRecipe,
  frontmatter: Record<string, unknown>,
  locale: string,
  allSlugs: readonly string[],
): string {
  const labels = i18n(locale).components.recipe

  // --- Metadata row ---
  const servings = (frontmatter["servings"] as number | undefined) ?? 1
  const prepTime = frontmatter["prep time"] as string | undefined
  const cookTime = frontmatter["cook time"] as string | undefined
  const totalTime = frontmatter["time required"] as string | undefined
  const source = frontmatter["source"] as string | undefined

  const timeChips = [
    prepTime
      ? `<span class="recipe-time-chip"><span class="time-label">${labels.prep}</span> ${escapeHtml(prepTime)}</span>`
      : "",
    cookTime
      ? `<span class="recipe-time-chip"><span class="time-label">${labels.cook}</span> ${escapeHtml(cookTime)}</span>`
      : "",
    totalTime
      ? `<span class="recipe-time-chip"><span class="time-label">${labels.total}</span> ${escapeHtml(totalTime)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ")

  const sourceLink = source
    ? `<a href="${escapeHtml(source)}" class="recipe-source" target="_blank" rel="noopener noreferrer">${labels.source} ↗</a>`
    : ""

  const metaHTML = `<div class="recipe-meta">
  <div class="servings-control">
    <span>${escapeHtml(labels.servings)}</span>
    <button class="servings-btn" data-delta="-1">−</button>
    <span id="servings-display" data-base="${servings}">${servings}</span>
    <button class="servings-btn" data-delta="1">+</button>
  </div>
  ${timeChips ? `<div class="recipe-time-chips">\n    ${timeChips}\n  </div>` : ""}
  ${sourceLink}
</div>`

  // --- Cookware list (deduplicated globally) ---
  const seenCookware = new Set<string>()
  const allCookware: Array<{ name: string; quantity: string | null }> = []
  for (const section of recipe.sections) {
    for (const step of section.steps) {
      for (const tok of step.tokens) {
        if (tok.type !== "cookware") continue
        const key = tok.cookware.name.toLowerCase()
        if (!seenCookware.has(key)) {
          seenCookware.add(key)
          allCookware.push(tok.cookware)
        }
      }
    }
  }

  const cookwareHTML =
    allCookware.length > 0
      ? `<h2 id="ustensiles">${escapeHtml(labels.cookware)}</h2>
<ul class="cookware-list">
  ${allCookware
    .map(
      (c) =>
        `<li>${escapeHtml(c.name)}${c.quantity ? ` <span class="cw-qty">${escapeHtml(c.quantity)}</span>` : ""}</li>`,
    )
    .join("\n  ")}
</ul>`
      : ""

  // --- Ingredients section ---
  let ingredientsHTML = `<h2 id="ingredients">${escapeHtml(labels.ingredients)}</h2>\n`
  let hasAnyIngredients = false
  for (const section of recipe.sections) {
    const listHTML = renderIngredientList(section, labels)
    if (!listHTML) continue
    hasAnyIngredients = true
    if (section.name) {
      ingredientsHTML += `<h3 id="ing-${slugify(section.name)}">${escapeHtml(section.name)}</h3>\n`
    }
    ingredientsHTML += listHTML + "\n"
  }
  if (!hasAnyIngredients) ingredientsHTML = ""

  // --- Instructions section ---
  let instructionsHTML = `<h2 id="instructions">${escapeHtml(labels.instructions)}</h2>\n`
  for (const section of recipe.sections) {
    if (section.steps.length === 0) continue
    if (section.name) {
      instructionsHTML += `<h3 id="inst-${slugify(section.name)}">${escapeHtml(section.name)}</h3>\n`
    }
    let stepNum = 1
    for (const step of section.steps) {
      const inner = renderTokens(step.tokens, allSlugs)
      if (step.isText) {
        instructionsHTML += `<div class="step-block text-step"><p>${inner}</p></div>\n`
      } else {
        instructionsHTML += `<div class="step-block"><p><span class="step-num">${stepNum}.</span> ${inner}</p></div>\n`
        stepNum++
      }
    }
  }

  return [metaHTML, cookwareHTML, ingredientsHTML, instructionsHTML].filter(Boolean).join("\n")
}
