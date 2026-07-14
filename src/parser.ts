import type { Quantity, ParseMode, DuplicateMode } from "./types"

// Pure string -> struct helpers, reused by the cooklang remark plugin (transformer.ts)
// when it scans already-parsed mdast text nodes for cooklang inline syntax. Extracted
// here (rather than inlined) so they stay independently unit-testable.

// Temperature pattern: number, optional decimal, optional space, degree symbol, unit letter
export const TEMP_RE = /(\d+(?:\.\d+)?)\s*[°ºˆ˚]([CcFfKk])\b/g

export function parseModeDirective(line: string): ParseMode | null {
  const m = line.trim().match(/^\[mode:\s*(all|default|ingredients|steps|text)\s*\]$/i)
  if (!m?.[1]) return null
  const v = m[1].toLowerCase()
  return v === "all" ? "default" : (v as ParseMode)
}

export function parseDuplicateDirective(line: string): DuplicateMode | null {
  const m = line.trim().match(/^\[duplicate:\s*(new|default|reference|ref)\s*\]$/i)
  if (!m?.[1]) return null
  const v = m[1].toLowerCase()
  return v === "ref" || v === "reference" ? "reference" : "new"
}

export function parseQuantity(content: string): { quantity: Quantity; unit: string | null } {
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
  if (spaceMatch?.[1] && spaceMatch[2]) {
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

export function extractNameParts(raw: string): {
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
  if (prepMatch?.[1] != null && prepMatch[2] != null) {
    name = prepMatch[1].trim()
    preparation = prepMatch[2].trim() || null
  }

  return { name, alias, preparation }
}
