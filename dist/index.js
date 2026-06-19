import { createRequire } from 'module';

createRequire(import.meta.url);

// src/parser.ts
var TEMP_RE = /(\d+(?:\.\d+)?)\s*[°ºˆ˚]([CcFfKk])\b/g;
function stripFrontmatter(src) {
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
function stripBlockComments(src) {
  return src.replace(/\[-[\s\S]*?-\]/g, "");
}
function stripInlineComment(line) {
  const idx = line.indexOf("--");
  if (idx === -1) return line;
  return line.slice(0, idx);
}
function parseModeDirective(line) {
  const m = line.trim().match(/^\[mode:\s*(all|default|ingredients|steps|text)\s*\]$/i);
  if (!m?.[1]) return null;
  const v = m[1].toLowerCase();
  return v === "all" ? "default" : v;
}
function parseDuplicateDirective(line) {
  const m = line.trim().match(/^\[duplicate:\s*(new|default|reference|ref)\s*\]$/i);
  if (!m?.[1]) return null;
  const v = m[1].toLowerCase();
  return v === "ref" || v === "reference" ? "reference" : "new";
}
function parseSectionHeader(line) {
  if (!line.startsWith("==")) return null;
  const m = line.match(/^=+\s*(.*?)\s*=*\s*$/);
  return m?.[1]?.trim() || null;
}
function parseQuantity(content) {
  const trimmed = content.trim();
  if (!trimmed) return { quantity: { kind: "none" }, unit: null };
  const pctIdx = trimmed.indexOf("%");
  if (pctIdx !== -1) {
    const qtyPart = trimmed.slice(0, pctIdx).trim();
    const unit = trimmed.slice(pctIdx + 1).trim() || null;
    const dashIdx2 = qtyPart.lastIndexOf("-");
    if (dashIdx2 > 0) {
      const low = qtyPart.slice(0, dashIdx2).trim();
      const high = qtyPart.slice(dashIdx2 + 1).trim();
      if (low && high && !isNaN(Number(low)) && !isNaN(Number(high))) {
        return { quantity: { kind: "range", low, high }, unit };
      }
    }
    return { quantity: { kind: "scalar", value: qtyPart }, unit };
  }
  const spaceMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s+(\S+)$/);
  if (spaceMatch?.[1] && spaceMatch[2]) {
    return { quantity: { kind: "scalar", value: spaceMatch[1] }, unit: spaceMatch[2] };
  }
  const dashIdx = trimmed.lastIndexOf("-");
  if (dashIdx > 0) {
    const low = trimmed.slice(0, dashIdx).trim();
    const high = trimmed.slice(dashIdx + 1).trim();
    if (low && high && !isNaN(Number(low)) && !isNaN(Number(high))) {
      return { quantity: { kind: "range", low, high }, unit: null };
    }
  }
  return { quantity: { kind: "scalar", value: trimmed }, unit: null };
}
function extractNameParts(raw) {
  let name = raw.trim();
  let alias = null;
  let preparation = null;
  const pipeIdx = name.indexOf("|");
  if (pipeIdx !== -1) {
    alias = name.slice(pipeIdx + 1).trim();
    name = name.slice(0, pipeIdx).trim();
  }
  const prepMatch = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (prepMatch?.[1] != null && prepMatch[2] != null) {
    name = prepMatch[1].trim();
    preparation = prepMatch[2].trim() || null;
  }
  return { name, alias, preparation };
}
function expandTemperatures(tokens) {
  const result = [];
  for (const tok of tokens) {
    if (tok.type !== "text") {
      result.push(tok);
      continue;
    }
    TEMP_RE.lastIndex = 0;
    let last = 0;
    let match;
    const src = tok.value;
    while ((match = TEMP_RE.exec(src)) !== null) {
      if (match.index > last) {
        result.push({ type: "text", value: src.slice(last, match.index) });
      }
      result.push({ type: "temperature", raw: match[0] });
      last = match.index + match[0].length;
    }
    if (last < src.length) {
      result.push({ type: "text", value: src.slice(last) });
    }
  }
  return result;
}
function tokenizeLine(src, mode) {
  if (mode === "text") return [{ type: "text", value: src }];
  const tokens = [];
  let pos = 0;
  let textStart = 0;
  function flushText(end) {
    if (end > textStart) tokens.push({ type: "text", value: src.slice(textStart, end) });
    textStart = end;
  }
  function findBrace(from) {
    const nlIdx = src.indexOf("\n", from);
    const braceIdx = src.indexOf("{", from);
    if (braceIdx === -1) return -1;
    if (nlIdx !== -1 && braceIdx > nlIdx) return -1;
    return braceIdx;
  }
  while (pos < src.length) {
    const ch = src[pos];
    if (src.startsWith("--", pos)) {
      flushText(pos);
      break;
    }
    if (src.startsWith("[[", pos)) {
      flushText(pos);
      pos += 2;
      const closeIdx = src.indexOf("]]", pos);
      if (closeIdx === -1) {
        textStart = pos - 2;
        continue;
      }
      const inner = src.slice(pos, closeIdx);
      pos = closeIdx + 2;
      textStart = pos;
      const pipeIdx = inner.indexOf("|");
      if (pipeIdx !== -1) {
        tokens.push({
          type: "wiki-link",
          target: inner.slice(0, pipeIdx).trim(),
          display: inner.slice(pipeIdx + 1).trim()
        });
      } else {
        tokens.push({ type: "wiki-link", target: inner.trim(), display: null });
      }
      continue;
    }
    if (ch === "@") {
      flushText(pos);
      pos++;
      let modifier = null;
      if (src[pos] === "@") {
        modifier = "recipe";
        pos++;
      } else if (src[pos] === "?") {
        modifier = "optional";
        pos++;
      } else if (src[pos] === "-") {
        modifier = "hidden";
        pos++;
      } else if (src[pos] === "&") {
        modifier = "reference";
        pos++;
        if (src[pos] === "(") {
          const closeIdx = src.indexOf(")", pos);
          if (closeIdx !== -1) pos = closeIdx + 1;
        }
      } else if (src[pos] === "+") {
        modifier = "new";
        pos++;
      }
      const nameStart = pos;
      const braceIdx = findBrace(pos);
      let nameRaw;
      if (braceIdx !== -1) {
        nameRaw = src.slice(nameStart, braceIdx);
        pos = braceIdx;
      } else {
        const wsMatch = src.slice(pos).match(/^[^\s{#@~[\]]+/);
        nameRaw = wsMatch ? wsMatch[0] : "";
        pos += nameRaw.length;
      }
      const { name, alias, preparation: prepFromName } = extractNameParts(nameRaw);
      let quantity = { kind: "none" };
      let unit = null;
      let prepFromBraces = null;
      if (pos < src.length && src[pos] === "{") {
        pos++;
        const closeIdx = src.indexOf("}", pos);
        if (closeIdx !== -1) {
          const parsed = parseQuantity(src.slice(pos, closeIdx));
          quantity = parsed.quantity;
          unit = parsed.unit;
          pos = closeIdx + 1;
        }
      }
      if (pos < src.length && src[pos] === "(") {
        pos++;
        const closeIdx = src.indexOf(")", pos);
        if (closeIdx !== -1) {
          prepFromBraces = src.slice(pos, closeIdx).trim() || null;
          pos = closeIdx + 1;
        }
      }
      if (mode === "steps" && modifier !== "new") {
        modifier = "reference";
      }
      const ingredient = {
        name: name.trim(),
        alias,
        quantity,
        unit,
        modifier,
        preparation: prepFromBraces ?? prepFromName
      };
      tokens.push({ type: "ingredient", ingredient });
      textStart = pos;
      continue;
    }
    if (ch === "#") {
      flushText(pos);
      pos++;
      const nameStart = pos;
      const braceIdx = findBrace(pos);
      let nameRaw;
      if (braceIdx !== -1) {
        nameRaw = src.slice(nameStart, braceIdx);
        pos = braceIdx;
      } else {
        const wsMatch = src.slice(pos).match(/^[^\s{#@~[\]]+/);
        nameRaw = wsMatch ? wsMatch[0] : "";
        pos += nameRaw.length;
      }
      let quantity = null;
      if (pos < src.length && src[pos] === "{") {
        pos++;
        const closeIdx = src.indexOf("}", pos);
        if (closeIdx !== -1) {
          quantity = src.slice(pos, closeIdx).trim() || null;
          pos = closeIdx + 1;
        }
      }
      tokens.push({ type: "cookware", cookware: { name: nameRaw.trim(), quantity } });
      textStart = pos;
      continue;
    }
    if (ch === "~") {
      const prevCh = pos > 0 ? src[pos - 1] ?? " " : " ";
      const isMidWord = /[a-zA-ZÀ-ÿ0-9_]/.test(prevCh);
      const braceIdx = findBrace(pos + 1);
      if (isMidWord || braceIdx === -1) {
        pos++;
        continue;
      }
      flushText(pos);
      pos++;
      const timerName = src.slice(pos, braceIdx).trim() || null;
      pos = braceIdx + 1;
      const closeIdx = src.indexOf("}", pos);
      if (closeIdx === -1) {
        textStart = pos;
        continue;
      }
      const inside = src.slice(pos, closeIdx).trim();
      pos = closeIdx + 1;
      const pctIdx = inside.indexOf("%");
      if (pctIdx !== -1) {
        const timer = {
          name: timerName,
          quantity: inside.slice(0, pctIdx).trim(),
          unit: inside.slice(pctIdx + 1).trim()
        };
        tokens.push({ type: "timer", timer });
      }
      textStart = pos;
      continue;
    }
    pos++;
  }
  flushText(pos);
  return expandTemperatures(tokens);
}
function tokenizeParagraph(lines, mode) {
  const all = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) all.push({ type: "text", value: "\n" });
    const line = lines[i];
    if (line != null) all.push(...tokenizeLine(line, mode));
  }
  return all;
}
function parseCooklang(rawSrc) {
  const src = stripFrontmatter(stripBlockComments(rawSrc));
  const rawLines = src.split(/\r?\n/);
  let mode = "default";
  const sections = [{ name: null, steps: [] }];
  let currentParagraph = [];
  function flushParagraph() {
    const nonEmpty = currentParagraph.filter((l) => l.trim().length > 0);
    currentParagraph = [];
    if (nonEmpty.length === 0) return;
    const isTextMode = mode === "text";
    const tokens = tokenizeParagraph(nonEmpty, mode);
    if (mode === "ingredients") {
      if (!tokens.some((t) => t.type === "ingredient")) return;
    }
    sections.at(-1).steps.push({ tokens, isText: isTextMode });
  }
  for (const rawLine of rawLines) {
    const isBlank = rawLine.trim().length === 0;
    if (isBlank) {
      flushParagraph();
      continue;
    }
    if (rawLine.trimStart().startsWith("--")) continue;
    const stripped = stripInlineComment(rawLine).trimEnd();
    const trimmed = stripped.trim();
    const sectionName = parseSectionHeader(trimmed);
    if (sectionName !== null) {
      flushParagraph();
      sections.push({ name: sectionName, steps: [] });
      continue;
    }
    const newMode = parseModeDirective(trimmed);
    if (newMode !== null) {
      flushParagraph();
      mode = newMode;
      continue;
    }
    if (parseDuplicateDirective(trimmed) !== null) {
      flushParagraph();
      continue;
    }
    currentParagraph.push(stripped);
  }
  flushParagraph();
  if (sections[0]?.name === null && sections[0].steps.length === 0 && sections.length > 1) {
    sections.shift();
  }
  return { sections };
}

// src/i18n/locales/en-US.ts
var en_US_default = {
  components: {
    example: {
      title: "Example"
    },
    recipe: {
      ingredients: "Ingredients",
      instructions: "Instructions",
      cookware: "Equipment",
      servings: "Servings",
      opt: "OPT",
      recipe: "RECIPE",
      source: "Source",
      prep: "Prep",
      cook: "Cook",
      total: "Total"
    }
  }
};

// src/i18n/locales/fr.ts
var fr_default = {
  components: {
    example: {
      title: "Exemple"
    },
    recipe: {
      ingredients: "Ingr\xE9dients",
      instructions: "Instructions",
      cookware: "Ustensiles",
      servings: "Portions",
      opt: "OPT",
      recipe: "RECETTE",
      source: "Source",
      prep: "Pr\xE9paration",
      cook: "Cuisson",
      total: "Total"
    }
  }
};

// src/i18n/index.ts
var locales = {
  "en-US": en_US_default,
  en: en_US_default,
  "fr-FR": fr_default,
  fr: fr_default
};
function i18n(locale) {
  if (!locale) return en_US_default;
  return locales[locale] ?? locales[locale.split("-")[0]] ?? en_US_default;
}

// src/renderer.ts
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function slugify(text) {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function renderInlineText(text) {
  let result = escapeHtml(text);
  result = result.replace(/~~([\s\S]+?)~~/g, "<del>$1</del>").replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>").replace(/\*([^*\n]+?)\*/g, "<em>$1</em>").replace(/_([^_\n]+?)_/g, "<em>$1</em>").replace(/`([^`]+?)`/g, "<code>$1</code>").replace(/\n/g, "<br/>");
  return result;
}
function resolveWikiLink(target, allSlugs) {
  const normalized = target.replace(/^\.?\//, "").trim();
  const lower = normalized.toLowerCase();
  const exact = allSlugs.find((s) => s.toLowerCase() === lower);
  if (exact) return `/${exact}`;
  const targetFile = lower.split("/").pop() ?? lower;
  const byFile = allSlugs.find((s) => {
    const parts = s.toLowerCase().split("/");
    return parts[parts.length - 1] === targetFile;
  });
  if (byFile) return `/${byFile}`;
  return `/${normalized}`;
}
function wikiLinkDisplay(target) {
  const parts = target.split("/");
  return (parts[parts.length - 1] ?? target).replace(/-/g, " ");
}
function renderTokens(tokens, allSlugs) {
  return tokens.map((tok) => {
    switch (tok.type) {
      case "text":
        return renderInlineText(tok.value);
      case "ingredient": {
        const display = escapeHtml(tok.ingredient.alias ?? tok.ingredient.name);
        return `<span class="ingredient_ref">${display}</span>`;
      }
      case "cookware":
        return `<span class="cookware_ref">${escapeHtml(tok.cookware.name)}</span>`;
      case "timer":
        return `<span class="timer_ref">\u23F1 ${escapeHtml(tok.timer.quantity)} ${escapeHtml(tok.timer.unit)}</span>`;
      case "wiki-link": {
        const href = resolveWikiLink(tok.target, allSlugs);
        const display = escapeHtml(tok.display ?? wikiLinkDisplay(tok.target));
        return `<a href="${escapeHtml(href)}" class="internal">${display}</a>`;
      }
      case "temperature":
        return `<span class="cooklang-temperature">${escapeHtml(tok.raw)}</span>`;
      default:
        return "";
    }
  }).join("");
}
function renderIngredientList(section, labels) {
  const ingredients = [];
  for (const step of section.steps) {
    for (const tok of step.tokens) {
      if (tok.type !== "ingredient") continue;
      const { modifier } = tok.ingredient;
      if (modifier === "hidden" || modifier === "reference") continue;
      ingredients.push(tok.ingredient);
    }
  }
  if (ingredients.length === 0) return "";
  const items = ingredients.map((ing) => {
    const display = escapeHtml(ing.alias ?? ing.name);
    const prepHtml = ing.preparation ? ` <em class="ing-prep">(${escapeHtml(ing.preparation)})</em>` : "";
    let modBadge = `<span class="ingredient_modifiers"></span>`;
    if (ing.modifier === "optional") {
      modBadge = `<span class="ingredient_modifiers">${labels.opt}</span>`;
    } else if (ing.modifier === "recipe") {
      modBadge = `<span class="ingredient_modifiers recipe-badge">${labels.recipe}</span>`;
    }
    let qtyHtml = "";
    if (ing.quantity.kind === "scalar") {
      const unit = ing.unit ? `<span class="unit">${escapeHtml(ing.unit)}</span>` : "";
      qtyHtml = `<span class="ing-qty"><span class="scalable-value" data-base="${escapeHtml(ing.quantity.value)}">${escapeHtml(ing.quantity.value)}</span>${unit ? " " + unit : ""}</span>`;
    } else if (ing.quantity.kind === "range") {
      const unit = ing.unit ? `<span class="unit">${escapeHtml(ing.unit)}</span>` : "";
      qtyHtml = `<span class="ing-qty"><span class="scalable-range" data-base-low="${escapeHtml(ing.quantity.low)}" data-base-high="${escapeHtml(ing.quantity.high)}">${escapeHtml(ing.quantity.low)}-${escapeHtml(ing.quantity.high)}</span>${unit ? " " + unit : ""}</span>`;
    }
    return `<li><span>${modBadge}<span>${display}${prepHtml}</span></span>${qtyHtml}</li>`;
  }).join("\n");
  return `<ul class="ing-list">
${items}
</ul>`;
}
function buildRecipeHTML(recipe, frontmatter, locale, allSlugs) {
  const labels = i18n(locale).components.recipe;
  const servings = frontmatter["servings"] ?? 1;
  const prepTime = frontmatter["prep time"];
  const cookTime = frontmatter["cook time"];
  const totalTime = frontmatter["time required"];
  const source = frontmatter["source"];
  const timeChips = [
    prepTime ? `<span class="recipe-time-chip"><span class="time-label">${labels.prep}</span> ${escapeHtml(prepTime)}</span>` : "",
    cookTime ? `<span class="recipe-time-chip"><span class="time-label">${labels.cook}</span> ${escapeHtml(cookTime)}</span>` : "",
    totalTime ? `<span class="recipe-time-chip"><span class="time-label">${labels.total}</span> ${escapeHtml(totalTime)}</span>` : ""
  ].filter(Boolean).join("\n    ");
  const sourceLink = source ? `<a href="${escapeHtml(source)}" class="recipe-source" target="_blank" rel="noopener noreferrer">${labels.source} \u2197</a>` : "";
  const metaHTML = `<div class="recipe-meta">
  <div class="servings-control">
    <span>${escapeHtml(labels.servings)}</span>
    <button class="servings-btn" data-delta="-1">\u2212</button>
    <span id="servings-display" data-base="${servings}">${servings}</span>
    <button class="servings-btn" data-delta="1">+</button>
  </div>
  ${timeChips ? `<div class="recipe-time-chips">
    ${timeChips}
  </div>` : ""}
  ${sourceLink}
</div>`;
  const seenCookware = /* @__PURE__ */ new Set();
  const allCookware = [];
  for (const section of recipe.sections) {
    for (const step of section.steps) {
      for (const tok of step.tokens) {
        if (tok.type !== "cookware") continue;
        const key = tok.cookware.name.toLowerCase();
        if (!seenCookware.has(key)) {
          seenCookware.add(key);
          allCookware.push(tok.cookware);
        }
      }
    }
  }
  const cookwareHTML = allCookware.length > 0 ? `<h2 id="ustensiles">${escapeHtml(labels.cookware)}</h2>
<ul class="cookware-list">
  ${allCookware.map(
    (c) => `<li>${escapeHtml(c.name)}${c.quantity ? ` <span class="cw-qty">${escapeHtml(c.quantity)}</span>` : ""}</li>`
  ).join("\n  ")}
</ul>` : "";
  let ingredientsHTML = `<h2 id="ingredients">${escapeHtml(labels.ingredients)}</h2>
`;
  let hasAnyIngredients = false;
  for (const section of recipe.sections) {
    const listHTML = renderIngredientList(section, labels);
    if (!listHTML) continue;
    hasAnyIngredients = true;
    if (section.name) {
      ingredientsHTML += `<h3 id="ing-${slugify(section.name)}">${escapeHtml(section.name)}</h3>
`;
    }
    ingredientsHTML += listHTML + "\n";
  }
  if (!hasAnyIngredients) ingredientsHTML = "";
  let instructionsHTML = `<h2 id="instructions">${escapeHtml(labels.instructions)}</h2>
`;
  for (const section of recipe.sections) {
    if (section.steps.length === 0) continue;
    if (section.name) {
      instructionsHTML += `<h3 id="inst-${slugify(section.name)}">${escapeHtml(section.name)}</h3>
`;
    }
    let stepNum = 1;
    for (const step of section.steps) {
      const inner = renderTokens(step.tokens, allSlugs);
      if (step.isText) {
        instructionsHTML += `<div class="step-block text-step"><p>${inner}</p></div>
`;
      } else {
        instructionsHTML += `<div class="step-block"><p><span class="step-num">${stepNum}.</span> ${inner}</p></div>
`;
        stepNum++;
      }
    }
  }
  return [metaHTML, cookwareHTML, ingredientsHTML, instructionsHTML].filter(Boolean).join("\n");
}

// src/components/styles/recipe.scss
var recipe_default = ".recipe-meta {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 1rem;\n  margin-bottom: 1.5rem;\n  padding: 0.75rem 1rem;\n  background-color: var(--light);\n  border: 1px solid var(--lightgray);\n  border-radius: 8px;\n}\n\n.servings-control {\n  display: flex;\n  align-items: center;\n  gap: 0.5rem;\n  font-weight: 500;\n}\n\n.servings-btn {\n  width: 1.8rem;\n  height: 1.8rem;\n  border: 1px solid var(--lightgray);\n  background: var(--light);\n  color: var(--dark);\n  border-radius: 4px;\n  cursor: pointer;\n  font-size: 1rem;\n  line-height: 1;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  transition: background 0.15s;\n}\n.servings-btn:hover {\n  background: var(--lightgray);\n}\n\n#servings-display {\n  min-width: 1.5rem;\n  text-align: center;\n  font-weight: 700;\n}\n\n.recipe-time-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 0.5rem;\n}\n\n.recipe-time-chip {\n  font-size: 0.85rem;\n  padding: 0.2rem 0.6rem;\n  background: var(--lightgray);\n  border-radius: 20px;\n}\n.recipe-time-chip .time-label {\n  font-weight: 600;\n  margin-right: 0.2rem;\n}\n\n.recipe-source {\n  font-size: 0.85rem;\n  margin-left: auto;\n  color: var(--secondary);\n}\n\n.cookware-list,\n.ing-list {\n  list-style: none;\n  padding: 0;\n  margin: 0 0 1rem;\n}\n\n.ing-list li {\n  display: flex;\n  justify-content: space-between;\n  align-items: baseline;\n  padding: 0.3rem 0;\n  border-bottom: 1px solid var(--lightgray);\n  gap: 1rem;\n}\n.ing-list li:last-child {\n  border-bottom: none;\n}\n\n.ingredient_modifiers {\n  font-size: 0.65rem;\n  font-weight: 700;\n  color: var(--gray);\n  letter-spacing: 0.05em;\n  margin-right: 0.35rem;\n  vertical-align: middle;\n}\n.ingredient_modifiers.recipe-badge {\n  color: var(--secondary);\n}\n\n.ing-qty {\n  display: flex;\n  align-items: baseline;\n  gap: 0.2rem;\n  white-space: nowrap;\n  font-weight: 500;\n  flex-shrink: 0;\n}\n\n.unit {\n  color: var(--gray);\n  font-size: 0.9em;\n}\n\n.ing-prep {\n  font-style: italic;\n  color: var(--gray);\n  font-size: 0.9em;\n}\n\n.cookware-list li {\n  padding: 0.25rem 0;\n  border-bottom: 1px solid var(--lightgray);\n}\n.cookware-list li:last-child {\n  border-bottom: none;\n}\n\n.cw-qty {\n  color: var(--gray);\n  font-size: 0.9em;\n  margin-left: 0.25rem;\n}\n\n.step-block {\n  margin: 0 0 0.6rem;\n  padding: 0.6rem 0.9rem;\n  background: var(--light);\n  border-left: 3px solid var(--lightgray);\n  border-radius: 0 4px 4px 0;\n}\n.step-block p {\n  margin: 0;\n  line-height: 1.6;\n}\n.step-block.text-step {\n  border-left-color: transparent;\n  background: transparent;\n  padding-left: 0;\n}\n\n.step-num {\n  font-weight: 700;\n  margin-right: 0.35rem;\n  color: var(--secondary);\n}\n\n.ingredient_ref {\n  color: var(--secondary);\n  font-weight: 500;\n}\n\n.cookware_ref {\n  color: var(--tertiary);\n  font-style: italic;\n}\n\n.timer_ref {\n  display: inline-flex;\n  align-items: center;\n  gap: 0.2rem;\n  font-weight: 500;\n  color: var(--dark);\n  background: var(--lightgray);\n  padding: 0.05rem 0.45rem;\n  border-radius: 4px;\n  font-size: 0.9em;\n}\n\n.cooklang-temperature {\n  font-weight: 500;\n}\n\n.recipe-link {\n  font-weight: 500;\n}";

// src/components/scripts/recipe.inline.ts
var recipe_inline_default = 'function l(){let s=document.getElementById("servings-display");if(!s)return;let c=parseInt(s.dataset.base??"1",10),n=c;function r(e){if(Number.isInteger(e))return e;let t=Math.round(e*10)/10;return Number.isInteger(t),t}function d(e){n=Math.max(1,n+e),s.textContent=String(n);let t=n/c;document.querySelectorAll(".scalable-value").forEach(a=>{let o=parseFloat(a.dataset.base??"0");a.textContent=String(r(o*t))}),document.querySelectorAll(".scalable-range").forEach(a=>{let o=parseFloat(a.dataset.baseLow??"0"),i=parseFloat(a.dataset.baseHigh??"0");a.textContent=`${r(o*t)}-${r(i*t)}`})}document.querySelectorAll(".servings-btn[data-delta]").forEach(e=>{let t=parseInt(e.dataset.delta??"0",10),a=()=>d(t);e.addEventListener("click",a),window.addCleanup(()=>e.removeEventListener("click",a))})}document.addEventListener("nav",l);\n';

// src/transformer.ts
var CooklangTransformer = (_opts) => {
  return {
    name: "CooklangTransformer",
    markdownPlugins(_ctx) {
      const cooklangRemark = () => (tree, file) => {
        const fm = file.data?.frontmatter ?? {};
        if (fm["format"] !== "cooklang") return;
        const raw = String(file.value).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
        file.data.cooklang = parseCooklang(raw);
        tree.children = [];
      };
      return [cooklangRemark];
    },
    htmlPlugins(ctx) {
      const cooklangRehype = () => (tree, file) => {
        if (!file.data?.cooklang) return;
        const fm = file.data?.frontmatter ?? {};
        const locale = fm["locale"] ?? "en";
        const slugs = ctx.allSlugs;
        const html = buildRecipeHTML(file.data.cooklang, fm, locale, slugs);
        tree.children = [{ type: "raw", value: html }];
      };
      return [cooklangRehype];
    },
    externalResources() {
      return {
        css: [{ content: recipe_default, inline: true }],
        js: [
          {
            contentType: "inline",
            loadTime: "afterDOMReady",
            script: recipe_inline_default
          }
        ]
      };
    }
  };
};

export { CooklangTransformer, parseCooklang, CooklangTransformer as transformer };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map