import type {
  CooklangRecipe,
  DuplicateMode,
  IngredientModifier,
  ParsedCookware,
  ParsedIngredient,
  ParsedSection,
  ParsedStep,
  ParsedTimer,
  ParseMode,
  Quantity,
  StepToken,
} from "./types"

// Temperature pattern: number, optional decimal, optional space, degree symbol, unit letter
const TEMP_RE = /(\d+(?:\.\d+)?)\s*[°ºˆ˚]([CcFfKk])\b/g

function stripFrontmatter(src: string): string {
  return src.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
}

function stripBlockComments(src: string): string {
  return src.replace(/\[-[\s\S]*?-\]/g, "")
}

function stripInlineComment(line: string): string {
  const idx = line.indexOf("--")
  if (idx === -1) return line
  return line.slice(0, idx)
}

function parseModeDirective(line: string): ParseMode | null {
  const m = line.trim().match(/^\[mode:\s*(all|default|ingredients|steps|text)\s*\]$/i)
  if (!m) return null
  const v = m[1].toLowerCase()
  return v === "all" ? "default" : (v as ParseMode)
}

function parseDuplicateDirective(line: string): DuplicateMode | null {
  const m = line.trim().match(/^\[duplicate:\s*(new|default|reference|ref)\s*\]$/i)
  if (!m) return null
  const v = m[1].toLowerCase()
  return v === "ref" || v === "reference" ? "reference" : "new"
}

function parseSectionHeader(line: string): string | null {
  if (!line.startsWith("==")) return null
  const m = line.match(/^=+\s*(.*?)\s*=*\s*$/)
  return m?.[1]?.trim() || null
}

function parseQuantity(content: string): { quantity: Quantity; unit: string | null } {
  const trimmed = content.trim()
  if (!trimmed) return { quantity: { kind: "none" }, unit: null }

  const pctIdx = trimmed.indexOf("%")
  if (pctIdx !== -1) {
    const qtyPart = trimmed.slice(0, pctIdx).trim()
    const unit = trimmed.slice(pctIdx + 1).trim() || null
    const dashIdx = qtyPart.lastIndexOf("-")
    if (dashIdx > 0) {
      const low = qtyPart.slice(0, dashIdx).trim()
      const high = qtyPart.slice(dashIdx + 1).trim()
      if (low && high && !isNaN(Number(low)) && !isNaN(Number(high))) {
        return { quantity: { kind: "range", low, high }, unit }
      }
    }
    return { quantity: { kind: "scalar", value: qtyPart }, unit }
  }

  // Advanced units extension: space separator "1 L"
  const spaceMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s+(\S+)$/)
  if (spaceMatch) {
    return { quantity: { kind: "scalar", value: spaceMatch[1] }, unit: spaceMatch[2] }
  }

  // Range without unit: "2-4"
  const dashIdx = trimmed.lastIndexOf("-")
  if (dashIdx > 0) {
    const low = trimmed.slice(0, dashIdx).trim()
    const high = trimmed.slice(dashIdx + 1).trim()
    if (low && high && !isNaN(Number(low)) && !isNaN(Number(high))) {
      return { quantity: { kind: "range", low, high }, unit: null }
    }
  }

  return { quantity: { kind: "scalar", value: trimmed }, unit: null }
}

function extractNameParts(raw: string): {
  name: string
  alias: string | null
  preparation: string | null
} {
  let name = raw.trim()
  let alias: string | null = null
  let preparation: string | null = null

  // Alias: "white wine|wine"
  const pipeIdx = name.indexOf("|")
  if (pipeIdx !== -1) {
    alias = name.slice(pipeIdx + 1).trim()
    name = name.slice(0, pipeIdx).trim()
  }

  // Preparation note: "concombres (noha - moyen)"
  const prepMatch = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  if (prepMatch) {
    name = prepMatch[1].trim()
    preparation = prepMatch[2].trim() || null
  }

  return { name, alias, preparation }
}

function expandTemperatures(tokens: StepToken[]): StepToken[] {
  const result: StepToken[] = []
  for (const tok of tokens) {
    if (tok.type !== "text") {
      result.push(tok)
      continue
    }
    TEMP_RE.lastIndex = 0
    let last = 0
    let match: RegExpExecArray | null
    const src = tok.value
    while ((match = TEMP_RE.exec(src)) !== null) {
      if (match.index > last) {
        result.push({ type: "text", value: src.slice(last, match.index) })
      }
      result.push({ type: "temperature", raw: match[0] })
      last = match.index + match[0].length
    }
    if (last < src.length) {
      result.push({ type: "text", value: src.slice(last) })
    }
  }
  return result
}

function tokenizeLine(src: string, mode: ParseMode): StepToken[] {
  if (mode === "text") return [{ type: "text", value: src }]

  const tokens: StepToken[] = []
  let pos = 0
  let textStart = 0

  function flushText(end: number) {
    if (end > textStart) tokens.push({ type: "text", value: src.slice(textStart, end) })
    textStart = end
  }

  // Returns the index of the next '{' on the same line, or -1
  function findBrace(from: number): number {
    const nlIdx = src.indexOf("\n", from)
    const braceIdx = src.indexOf("{", from)
    if (braceIdx === -1) return -1
    if (nlIdx !== -1 && braceIdx > nlIdx) return -1
    return braceIdx
  }

  while (pos < src.length) {
    const ch = src[pos]

    // Inline comment
    if (src.startsWith("--", pos)) {
      flushText(pos)
      break
    }

    // Wiki-link [[...]]
    if (src.startsWith("[[", pos)) {
      flushText(pos)
      pos += 2
      const closeIdx = src.indexOf("]]", pos)
      if (closeIdx === -1) {
        textStart = pos - 2
        continue
      }
      const inner = src.slice(pos, closeIdx)
      pos = closeIdx + 2
      textStart = pos
      const pipeIdx = inner.indexOf("|")
      if (pipeIdx !== -1) {
        tokens.push({
          type: "wiki-link",
          target: inner.slice(0, pipeIdx).trim(),
          display: inner.slice(pipeIdx + 1).trim(),
        })
      } else {
        tokens.push({ type: "wiki-link", target: inner.trim(), display: null })
      }
      continue
    }

    // Ingredient @
    if (ch === "@") {
      flushText(pos)
      pos++ // consume first @
      let modifier: IngredientModifier = null

      if (src[pos] === "@") {
        modifier = "recipe"
        pos++
      } else if (src[pos] === "?") {
        modifier = "optional"
        pos++
      } else if (src[pos] === "-") {
        modifier = "hidden"
        pos++
      } else if (src[pos] === "&") {
        modifier = "reference"
        pos++
        // Consume intermediate preparation selector @&(~1) or @&(2) etc.
        if (src[pos] === "(") {
          const closeIdx = src.indexOf(")", pos)
          if (closeIdx !== -1) pos = closeIdx + 1
        }
      } else if (src[pos] === "+") {
        modifier = "new"
        pos++
      }

      const nameStart = pos
      const braceIdx = findBrace(pos)

      let nameRaw: string
      if (braceIdx !== -1) {
        nameRaw = src.slice(nameStart, braceIdx)
        pos = braceIdx
      } else {
        // Single-word name: read until whitespace or special char
        const wsMatch = src.slice(pos).match(/^[^\s{#@~[\]]+/)
        nameRaw = wsMatch ? wsMatch[0] : ""
        pos += nameRaw.length
      }

      const { name, alias, preparation: prepFromName } = extractNameParts(nameRaw)

      let quantity: Quantity = { kind: "none" }
      let unit: string | null = null
      let prepFromBraces: string | null = null

      if (pos < src.length && src[pos] === "{") {
        pos++
        const closeIdx = src.indexOf("}", pos)
        if (closeIdx !== -1) {
          const parsed = parseQuantity(src.slice(pos, closeIdx))
          quantity = parsed.quantity
          unit = parsed.unit
          pos = closeIdx + 1
        }
      }

      // Prep note after {} (canonical spec position)
      if (pos < src.length && src[pos] === "(") {
        pos++
        const closeIdx = src.indexOf(")", pos)
        if (closeIdx !== -1) {
          prepFromBraces = src.slice(pos, closeIdx).trim() || null
          pos = closeIdx + 1
        }
      }

      // In steps mode, treat as reference unless @+
      if (mode === "steps" && modifier !== "new") {
        modifier = "reference"
      }

      const ingredient: ParsedIngredient = {
        name: name.trim(),
        alias,
        quantity,
        unit,
        modifier,
        preparation: prepFromBraces ?? prepFromName,
      }

      tokens.push({ type: "ingredient", ingredient })
      textStart = pos
      continue
    }

    // Cookware #
    if (ch === "#") {
      flushText(pos)
      pos++

      const nameStart = pos
      const braceIdx = findBrace(pos)

      let nameRaw: string
      if (braceIdx !== -1) {
        nameRaw = src.slice(nameStart, braceIdx)
        pos = braceIdx
      } else {
        const wsMatch = src.slice(pos).match(/^[^\s{#@~[\]]+/)
        nameRaw = wsMatch ? wsMatch[0] : ""
        pos += nameRaw.length
      }

      let quantity: string | null = null
      if (pos < src.length && src[pos] === "{") {
        pos++
        const closeIdx = src.indexOf("}", pos)
        if (closeIdx !== -1) {
          quantity = src.slice(pos, closeIdx).trim() || null
          pos = closeIdx + 1
        }
      }

      tokens.push({ type: "cookware", cookware: { name: nameRaw.trim(), quantity } })
      textStart = pos
      continue
    }

    // Timer ~
    if (ch === "~") {
      // Only parse as timer if not mid-word and has braces ahead
      const prevCh = pos > 0 ? src[pos - 1] : " "
      const isMidWord = /[a-zA-ZÀ-ÿ0-9_]/.test(prevCh)
      const braceIdx = findBrace(pos + 1)

      if (isMidWord || braceIdx === -1) {
        pos++
        continue
      }

      flushText(pos)
      pos++ // consume ~

      const timerName = src.slice(pos, braceIdx).trim() || null
      pos = braceIdx + 1 // skip '{'

      const closeIdx = src.indexOf("}", pos)
      if (closeIdx === -1) {
        textStart = pos
        continue
      }

      const inside = src.slice(pos, closeIdx).trim()
      pos = closeIdx + 1

      const pctIdx = inside.indexOf("%")
      if (pctIdx !== -1) {
        const timer: ParsedTimer = {
          name: timerName,
          quantity: inside.slice(0, pctIdx).trim(),
          unit: inside.slice(pctIdx + 1).trim(),
        }
        tokens.push({ type: "timer", timer })
      }
      // Timers without units are invalid per extension spec — silently drop

      textStart = pos
      continue
    }

    pos++
  }

  flushText(pos)
  return expandTemperatures(tokens)
}

function tokenizeParagraph(lines: string[], mode: ParseMode): StepToken[] {
  const all: StepToken[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) all.push({ type: "text", value: "\n" })
    all.push(...tokenizeLine(lines[i], mode))
  }
  return all
}

export function parseCooklang(rawSrc: string): CooklangRecipe {
  const src = stripFrontmatter(stripBlockComments(rawSrc))
  const rawLines = src.split(/\r?\n/)

  let mode: ParseMode = "default"

  const sections: ParsedSection[] = [{ name: null, steps: [] }]
  let currentParagraph: string[] = []

  function flushParagraph() {
    const nonEmpty = currentParagraph.filter((l) => l.trim().length > 0)
    currentParagraph = []
    if (nonEmpty.length === 0) return

    const isTextMode = mode === "text"
    const tokens = tokenizeParagraph(nonEmpty, mode)

    // In ingredients-only mode, skip paragraphs with no ingredient tokens
    if (mode === "ingredients") {
      if (!tokens.some((t) => t.type === "ingredient")) return
    }

    sections[sections.length - 1].steps.push({ tokens, isText: isTextMode })
  }

  for (const rawLine of rawLines) {
    const isBlank = rawLine.trim().length === 0
    if (isBlank) {
      flushParagraph()
      continue
    }

    // Pure comment line — skip without flushing
    if (rawLine.trimStart().startsWith("--")) continue

    const stripped = stripInlineComment(rawLine).trimEnd()
    const trimmed = stripped.trim()

    // Section header
    const sectionName = parseSectionHeader(trimmed)
    if (sectionName !== null) {
      flushParagraph()
      sections.push({ name: sectionName, steps: [] })
      continue
    }

    // Mode directive
    const newMode = parseModeDirective(trimmed)
    if (newMode !== null) {
      flushParagraph()
      mode = newMode
      continue
    }

    // Duplicate directive (no rendering effect, just parse state)
    if (parseDuplicateDirective(trimmed) !== null) {
      flushParagraph()
      continue
    }

    currentParagraph.push(stripped)
  }

  flushParagraph()

  // Drop empty pre-amble section when sections follow
  if (sections[0].name === null && sections[0].steps.length === 0 && sections.length > 1) {
    sections.shift()
  }

  return { sections }
}
