import { visitParents } from "unist-util-visit-parents"
import { findAndReplace } from "mdast-util-find-and-replace"
import type { Break, PhrasingContent, RootContent, Text } from "mdast"
import type { Parent } from "unist"
import { TEMP_RE, extractNameParts, parseQuantity } from "./parser"
import { COOKWARE_MARKER, TIMER_SENTINEL_RE } from "./textTransform"
import type {
  CooklangCookwareNode,
  CooklangIngredientNode,
  CooklangTemperatureNode,
  CooklangTimerNode,
  IngredientModifier,
  ParseMode,
  Quantity,
} from "./types"

// Find the next '{' before the next literal newline (or end of the text node), or -1 —
// mirrors the original hand-rolled tokenizer's line-scoped brace lookup.
function findBrace(src: string, from: number): number {
  const nlIdx = src.indexOf("\n", from)
  const braceIdx = src.indexOf("{", from)
  if (braceIdx === -1) return -1
  if (nlIdx !== -1 && braceIdx > nlIdx) return -1
  return braceIdx
}

const NAME_FALLBACK_RE = new RegExp(`^[^\\s{@~[\\]${COOKWARE_MARKER}]+`)

function scanName(src: string, pos: number): { nameRaw: string; nextPos: number; braceIdx: number } {
  const braceIdx = findBrace(src, pos)
  if (braceIdx !== -1) return { nameRaw: src.slice(pos, braceIdx), nextPos: braceIdx, braceIdx }
  const wsMatch = src.slice(pos).match(NAME_FALLBACK_RE)
  const nameRaw = wsMatch ? wsMatch[0] : ""
  return { nameRaw, nextPos: pos + nameRaw.length, braceIdx: -1 }
}

function scanIngredientsAndCookware(src: string, mode: ParseMode): PhrasingContent[] {
  const nodes: PhrasingContent[] = []
  let pos = 0
  let textStart = 0

  function flushText(end: number) {
    if (end > textStart) nodes.push({ type: "text", value: src.slice(textStart, end) })
    textStart = end
  }

  while (pos < src.length) {
    const ch = src[pos]

    if (ch === "@") {
      flushText(pos)
      pos++
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
        if (src[pos] === "(") {
          const closeIdx = src.indexOf(")", pos)
          if (closeIdx !== -1) pos = closeIdx + 1
        }
      } else if (src[pos] === "+") {
        modifier = "new"
        pos++
      }

      const { nameRaw, nextPos } = scanName(src, pos)
      pos = nextPos
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

      if (pos < src.length && src[pos] === "(") {
        pos++
        const closeIdx = src.indexOf(")", pos)
        if (closeIdx !== -1) {
          prepFromBraces = src.slice(pos, closeIdx).trim() || null
          pos = closeIdx + 1
        }
      }

      if (mode === "steps" && modifier !== "new") modifier = "reference"

      const node: CooklangIngredientNode = {
        type: "cooklangIngredient",
        ingredient: {
          name: name.trim(),
          alias,
          quantity,
          unit,
          modifier,
          preparation: prepFromBraces ?? prepFromName,
        },
      }
      nodes.push(node)
      textStart = pos
      continue
    }

    if (ch === COOKWARE_MARKER) {
      flushText(pos)
      pos++
      const { nameRaw, nextPos } = scanName(src, pos)
      pos = nextPos

      let quantity: string | null = null
      if (pos < src.length && src[pos] === "{") {
        pos++
        const closeIdx = src.indexOf("}", pos)
        if (closeIdx !== -1) {
          quantity = src.slice(pos, closeIdx).trim() || null
          pos = closeIdx + 1
        }
      }

      const node: CooklangCookwareNode = {
        type: "cooklangCookware",
        cookware: { name: nameRaw.trim(), quantity },
      }
      nodes.push(node)
      textStart = pos
      continue
    }

    pos++
  }

  flushText(pos)
  return nodes
}

// Splices `@ingredient{}`/`#cookware{}` occurrences within `root`'s text descendants into
// custom cooklangIngredient/cooklangCookware nodes, reusing the same safe splice mechanics
// mdast-util-find-and-replace uses internally (return `index + inserted.length` to skip
// past the newly-inserted nodes during traversal).
const HAS_INGREDIENT_OR_COOKWARE_RE = new RegExp(`[@${COOKWARE_MARKER}]`)

export function substituteIngredientsAndCookware(root: RootContent, mode: ParseMode): void {
  visitParents(root, "text", (node: Text, parents: Parent[]) => {
    if (!HAS_INGREDIENT_OR_COOKWARE_RE.test(node.value)) return undefined
    const parent = parents[parents.length - 1]
    if (!parent) return undefined
    const siblings = parent.children as unknown[]
    const index = siblings.indexOf(node)
    if (index === -1) return undefined

    const replacement = scanIngredientsAndCookware(node.value, mode)
    siblings.splice(index, 1, ...replacement)
    return index + replacement.length
  })
}

export function substituteTemperature(root: RootContent): void {
  findAndReplace(root, [
    TEMP_RE,
    (raw: string): CooklangTemperatureNode => ({ type: "cooklangTemperature", raw }),
  ])
}

export function substituteTimerSentinels(root: RootContent): void {
  findAndReplace(root, [
    TIMER_SENTINEL_RE,
    (_value: string, rawName: string, rawQuantity: string, rawUnit: string): CooklangTimerNode => ({
      type: "cooklangTimer",
      timer: {
        name: decodeURIComponent(rawName) || null,
        quantity: decodeURIComponent(rawQuantity),
        unit: decodeURIComponent(rawUnit),
      },
    }),
  ])
}

// Replicates remark-breaks' effect (soft line breaks render as hard breaks) but scoped to
// a single retained block, so it never affects non-cooklang files sharing the same
// site-wide unified pipeline.
export function convertSoftBreaksToHardBreaks(root: RootContent): void {
  visitParents(root, "text", (node: Text, parents: Parent[]) => {
    if (!node.value.includes("\n")) return undefined
    const parent = parents[parents.length - 1]
    if (!parent) return undefined
    const siblings = parent.children as unknown[]
    const index = siblings.indexOf(node)
    if (index === -1) return undefined

    const parts = node.value.split("\n")
    const replacement: (Text | Break)[] = []
    parts.forEach((part, i) => {
      if (part.length > 0) replacement.push({ type: "text", value: part })
      if (i < parts.length - 1) replacement.push({ type: "break" })
    })

    siblings.splice(index, 1, ...replacement)
    return index + replacement.length
  })
}
