import { h } from "hastscript";
import { toHast } from "mdast-util-to-hast";
import type { Handlers } from "mdast-util-to-hast";
import { visit } from "unist-util-visit";
import type { Element, ElementContent, Nodes as HastNodes } from "hast";
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
} from "./types";
import { i18n } from "./i18n/index";
import { GroupedQuantity, formatNumber } from "./quantity";
import type { GroupedQuantityItem } from "./quantity";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const cooklangHandlers: Handlers = {
  cooklangIngredient(_state, node: CooklangIngredientNode) {
    return h("span", { class: "ingredient_ref" }, node.ingredient.alias ?? node.ingredient.name);
  },
  cooklangCookware(_state, node: CooklangCookwareNode) {
    return h("span", { class: "cookware_ref" }, node.cookware.name);
  },
  cooklangTimer(_state, node: CooklangTimerNode) {
    return h("span", { class: "timer_ref" }, `⏱ ${node.timer.quantity} ${node.timer.unit}`);
  },
  cooklangTemperature(_state, node: CooklangTemperatureNode) {
    return h("span", { class: "cooklang-temperature" }, node.raw);
  },
};

function convertBlockChildren(block: SectionBlock): ElementContent[] {
  const converted = toHast(block.mdastNode, { handlers: cooklangHandlers }) as HastNodes;
  if (converted.type === "root") return converted.children as ElementContent[];
  return [converted as ElementContent];
}

function renderBlock(block: SectionBlock, stepNum: number | null): Element {
  const children = convertBlockChildren(block);

  if (stepNum !== null) {
    const first = children[0];
    if (first && first.type === "element") {
      first.children = [
        h("span", { class: "step-num" }, `${stepNum}.`),
        { type: "text", value: " " },
        ...first.children,
      ];
    }
    return h("div", { class: "step-block" }, children);
  }

  const className = block.mode === "text" ? "step-block text-step" : "step-block";
  return h("div", { class: className }, children);
}

function renderQuantityItem(item: GroupedQuantityItem): ElementContent[] {
  const { value, unit } = item;
  let valueEl: Element;
  if (value.kind === "number") {
    const base = formatNumber(value.value);
    valueEl = h("span", { class: "scalable-value", "data-base": base }, value.raw ?? base);
  } else if (value.kind === "range") {
    const low = formatNumber(value.low);
    const high = formatNumber(value.high);
    valueEl = h(
      "span",
      { class: "scalable-range", "data-base-low": low, "data-base-high": high },
      value.raw ? `${value.raw.low}-${value.raw.high}` : `${low}-${high}`,
    );
  } else {
    // Free text ("un peu") can't be scaled.
    valueEl = h("span", { class: "text-value" }, value.value);
  }
  return unit
    ? [valueEl, { type: "text", value: " " }, h("span", { class: "unit" }, unit)]
    : [valueEl];
}

function renderQuantityHast(quantities: GroupedQuantity): ElementContent | null {
  const items = quantities.toList();
  if (items.length === 0) return null;
  const children: ElementContent[] = [];
  items.forEach((item, i) => {
    if (i > 0) children.push({ type: "text", value: ", " });
    children.push(...renderQuantityItem(item));
  });
  return h("span", { class: "ing-qty" }, children);
}

function renderIngredientLi(
  { ingredient, quantities }: ListedIngredient,
  labels: ReturnType<typeof i18n>["components"]["recipe"],
): Element {
  const display = ingredient.alias ?? ingredient.name;
  const prepEl = ingredient.preparation
    ? [" ", h("em", { class: "ing-prep" }, `(${ingredient.preparation})`)]
    : [];

  let modBadge: Element;
  if (ingredient.modifier === "optional") {
    modBadge = h("span", { class: "ingredient_modifiers" }, labels.opt);
  } else if (ingredient.modifier === "recipe") {
    modBadge = h("span", { class: "ingredient_modifiers recipe-badge" }, labels.recipe);
  } else {
    modBadge = h("span", { class: "ingredient_modifiers" });
  }

  const qtyEl = renderQuantityHast(quantities);

  return h("li", [
    h("span", [modBadge, h("span", [display, ...prepEl])]),
    ...(qtyEl ? [qtyEl] : []),
  ]);
}

interface ListedIngredient {
  ingredient: ParsedIngredient;
  quantities: GroupedQuantity;
}

function findLast<T>(items: T[], pred: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (pred(items[i]!)) return items[i];
  return undefined;
}

function sameName(a: ParsedIngredient, b: ParsedIngredient): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

// Resolves references the way cooklang-rs does, across the whole recipe (not per section):
//   - `@&name` adds its quantity to the last earlier definition with the same name;
//   - under `[duplicate: ref]`, a same-named ingredient (with the same optional-ness) is an
//     implicit reference, otherwise a new definition;
//   - `@&(~1)name` intermediate preparations are neither listed nor merged;
//   - a reference without any earlier definition falls back to being a definition.
// Each definition is listed once, in the section where it is defined, with the grouped
// quantities of itself and all its references. Hidden (`@-`) definitions are not listed.
function collectIngredients(sections: ParsedSection[]): ListedIngredient[][] {
  const definitions: ListedIngredient[] = [];
  const perSection: ListedIngredient[][] = sections.map(() => []);

  sections.forEach((section, sectionIdx) => {
    for (const block of section.blocks) {
      visit(block.mdastNode, "cooklangIngredient", (node: CooklangIngredientNode) => {
        const ing = node.ingredient;
        if (ing.intermediate) return;

        let target: ListedIngredient | undefined;
        if (ing.modifier === "reference") {
          target = findLast(definitions, (d) => sameName(d.ingredient, ing));
        } else if (ing.implicitReference) {
          const optional = ing.modifier === "optional";
          target = findLast(
            definitions,
            (d) =>
              sameName(d.ingredient, ing) && (d.ingredient.modifier === "optional") === optional,
          );
        }

        if (target) {
          target.quantities.add(ing.quantity, ing.unit);
          return;
        }

        const entry: ListedIngredient = { ingredient: ing, quantities: new GroupedQuantity() };
        entry.quantities.add(ing.quantity, ing.unit);
        definitions.push(entry);
        if (ing.modifier !== "hidden") perSection[sectionIdx]!.push(entry);
      });
    }
  });

  return perSection;
}

function collectCookware(sections: ParsedSection[]): ParsedCookware[] {
  const seen = new Set<string>();
  const cookware: ParsedCookware[] = [];
  for (const section of sections) {
    for (const block of section.blocks) {
      visit(block.mdastNode, "cooklangCookware", (node: CooklangCookwareNode) => {
        const key = node.cookware.name.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        cookware.push(node.cookware);
      });
    }
  }
  return cookware;
}

export function buildRecipeHast(
  recipe: CooklangRecipe,
  frontmatter: Record<string, unknown>,
  locale: string,
): ElementContent[] {
  const labels = i18n(locale).components.recipe;

  // --- Metadata row ---
  const servings = (frontmatter["servings"] as number | undefined) ?? 1;
  const prepTime = frontmatter["prep time"] as string | undefined;
  const cookTime = frontmatter["cook time"] as string | undefined;
  const totalTime = frontmatter["time required"] as string | undefined;
  const source = frontmatter["source"] as string | undefined;

  const timeChips = [
    prepTime ? { label: labels.prep, value: prepTime } : null,
    cookTime ? { label: labels.cook, value: cookTime } : null,
    totalTime ? { label: labels.total, value: totalTime } : null,
  ].filter((c): c is { label: string; value: string } => c !== null);

  const metaChildren: ElementContent[] = [
    h("div", { class: "servings-control" }, [
      h("span", labels.servings),
      h("button", { class: "servings-btn", "data-delta": "-1" }, "−"),
      h("span", { id: "servings-display", "data-base": String(servings) }, String(servings)),
      h("button", { class: "servings-btn", "data-delta": "1" }, "+"),
    ]),
  ];

  if (timeChips.length > 0) {
    metaChildren.push(
      h(
        "div",
        { class: "recipe-time-chips" },
        timeChips.map((chip) =>
          h("span", { class: "recipe-time-chip" }, [
            h("span", { class: "time-label" }, chip.label),
            " ",
            chip.value,
          ]),
        ),
      ),
    );
  }

  if (source) {
    metaChildren.push(
      h(
        "a",
        { href: source, class: "recipe-source", target: "_blank", rel: "noopener noreferrer" },
        `${labels.source} ↗`,
      ),
    );
  }

  const metaHast = h("div", { class: "recipe-meta" }, metaChildren);

  // --- Cookware list (deduplicated globally) ---
  const allCookware = collectCookware(recipe.sections);
  const cookwareNodes: ElementContent[] = [];
  if (allCookware.length > 0) {
    cookwareNodes.push(h("h2", { id: "ustensiles" }, labels.cookware));
    cookwareNodes.push(
      h(
        "ul",
        { class: "cookware-list" },
        allCookware.map((c) =>
          h(
            "li",
            c.quantity ? [c.name, " ", h("span", { class: "cw-qty" }, c.quantity)] : [c.name],
          ),
        ),
      ),
    );
  }

  // --- Ingredients section ---
  const ingredientsNodes: ElementContent[] = [];
  let hasAnyIngredients = false;
  const ingredientsPerSection = collectIngredients(recipe.sections);
  recipe.sections.forEach((section, sectionIdx) => {
    const ingredients = ingredientsPerSection[sectionIdx] ?? [];
    if (ingredients.length === 0) return;
    hasAnyIngredients = true;
    if (section.name) {
      ingredientsNodes.push(h("h3", { id: `ing-${slugify(section.name)}` }, section.name));
    }
    ingredientsNodes.push(
      h(
        "ul",
        { class: "ing-list" },
        ingredients.map((ing) => renderIngredientLi(ing, labels)),
      ),
    );
  });
  if (hasAnyIngredients)
    ingredientsNodes.unshift(h("h2", { id: "ingredients" }, labels.ingredients));

  // --- Instructions section ---
  const instructionsNodes: ElementContent[] = [
    h("h2", { id: "instructions" }, labels.instructions),
  ];
  for (const section of recipe.sections) {
    if (section.blocks.length === 0) continue;
    if (section.name) {
      instructionsNodes.push(h("h3", { id: `inst-${slugify(section.name)}` }, section.name));
    }
    let stepNum = 1;
    for (const block of section.blocks) {
      const num = block.numbered ? stepNum++ : null;
      instructionsNodes.push(renderBlock(block, num));
    }
  }

  return [metaHast, ...cookwareNodes, ...ingredientsNodes, ...instructionsNodes];
}
