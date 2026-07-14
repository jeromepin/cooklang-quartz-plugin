// Raw-text preprocessing for CookLang files, applied before Markdown parsing.
//
// This handles the things that are unsafe to leave for a post-parse mdast visit:
//  - comment stripping (must happen before Markdown ever sees `--`/`[- -]`)
//  - `== Section ==` headers, which collide with Obsidian's `==highlight==` syntax
//  - `~timer{qty%unit}` syntax, which collides with GFM strikethrough's default
//    `singleTilde: true` behavior (a lone `~` is a valid strikethrough delimiter)
//  - `#cookware{}` syntax, which collides with Obsidian's inline `#tag` syntax — since
//    CooklangTransformer must run after ObsidianFlavoredMarkdown, an unmarked `#` would
//    already have been consumed into a tag node before this plugin ever sees it
//
// Everything else (`@ingredient`, temperature, `[mode:]`/`[duplicate:]` directives) is
// safe to detect after normal Markdown parsing - see transformer.ts.

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const BLOCK_COMMENT_RE = /\[-[\s\S]*?-\]/g
const SECTION_HEADER_RE = /^=+\s*(.*?)\s*=*\s*$/

// Private-Use-Area codepoints are lexically inert to CommonMark/GFM/Obsidian, so
// encoding cooklang syntax into these sentinels guarantees zero parsing ambiguity.
// The ASCII Unit Separator control char is used as an in-payload field delimiter
// for the same reason.
const SECTION_SENTINEL_OPEN = "\u{E000}"
const SECTION_SENTINEL_CLOSE = "\u{E001}"
const TIMER_SENTINEL_OPEN = "\u{E010}"
const TIMER_SENTINEL_CLOSE = "\u{E011}"
const SENTINEL_FIELD_SEP = "\u{001F}"

// Single-character marker standing in for a `#` that starts a cookware reference. Unlike
// section headers and timers, cookware syntax doesn't need its whole payload encoded —
// only the triggering `#` itself is ambiguous (vs. Obsidian's `#tag`), so the rest of the
// existing name/brace scanner (mdastSubstitutions.ts) keeps working unchanged once it
// looks for this marker instead of a literal `#`.
export const COOKWARE_MARKER = "\u{E020}"

const TIMER_LINE_RE = /(^|[^\p{L}\p{N}_])~([^{}\n]*)\{([^{}]*)\}/gu

// A `#` starts a cookware reference when immediately followed by a valid name-start
// character (mirrors the existing name-scan fallback regex in mdastSubstitutions.ts).
// This excludes real ATX headings: `# Heading`/`## Heading` always have whitespace or
// another `#` right after the opening run, never a name character directly.
const COOKWARE_HASH_RE = /#(?=[^\s{#@~[\]])/g

export const SECTION_SENTINEL_RE = new RegExp(
  `^${SECTION_SENTINEL_OPEN}COOKLANG-SECTION:(.*)${SECTION_SENTINEL_CLOSE}$`,
)

export const TIMER_SENTINEL_RE = new RegExp(
  `${TIMER_SENTINEL_OPEN}([^${SENTINEL_FIELD_SEP}]*)${SENTINEL_FIELD_SEP}([^${SENTINEL_FIELD_SEP}]*)${SENTINEL_FIELD_SEP}([^${TIMER_SENTINEL_CLOSE}]*)${TIMER_SENTINEL_CLOSE}`,
  "g",
)

export function decodeSectionSentinelMatch(match: RegExpMatchArray): string | null {
  const raw = decodeURIComponent(match[1] ?? "")
  return raw || null
}

export function decodeTimerSentinelMatch(match: RegExpMatchArray): {
  name: string | null
  quantity: string
  unit: string
} {
  return {
    name: decodeURIComponent(match[1] ?? "") || null,
    quantity: decodeURIComponent(match[2] ?? ""),
    unit: decodeURIComponent(match[3] ?? ""),
  }
}

function isCooklangFrontmatter(yaml: string): boolean {
  return /^\s*format:\s*["']?cooklang["']?\s*$/im.test(yaml)
}

function stripInlineComment(line: string): string {
  const idx = line.indexOf("--")
  if (idx === -1) return line
  return line.slice(0, idx).trimEnd()
}

function encodeSectionSentinel(name: string): string {
  return `${SECTION_SENTINEL_OPEN}COOKLANG-SECTION:${encodeURIComponent(name)}${SECTION_SENTINEL_CLOSE}`
}

function markCookwareHashes(line: string): string {
  return line.replace(COOKWARE_HASH_RE, COOKWARE_MARKER)
}

function encodeTimersInLine(line: string): string {
  return line.replace(TIMER_LINE_RE, (full: string, pre: string, name: string, inside: string) => {
    const pctIdx = inside.indexOf("%")
    if (pctIdx === -1) return full // timers without units are invalid - leave as literal text
    const quantity = inside.slice(0, pctIdx).trim()
    const unit = inside.slice(pctIdx + 1).trim()
    return (
      `${pre}${TIMER_SENTINEL_OPEN}${encodeURIComponent(name.trim())}${SENTINEL_FIELD_SEP}` +
      `${encodeURIComponent(quantity)}${SENTINEL_FIELD_SEP}${encodeURIComponent(unit)}${TIMER_SENTINEL_CLOSE}`
    )
  })
}

function transformBody(body: string): string {
  const withoutBlockComments = body.replace(BLOCK_COMMENT_RE, "")
  const lines = withoutBlockComments.split(/\r?\n/)

  const withoutComments = lines
    .filter((line) => !line.trimStart().startsWith("--"))
    .map((line) => stripInlineComment(line))

  const withSections = withoutComments.flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith("==")) return [line]
    const name = trimmed.match(SECTION_HEADER_RE)?.[1]?.trim()
    if (!name) return [line]
    // Force blank-line separation so the sentinel always becomes its own paragraph,
    // regardless of whether the source had blank lines around the `==Name==` line.
    return ["", encodeSectionSentinel(name), ""]
  })

  return withSections.map(encodeTimersInLine).map(markCookwareHashes).join("\n")
}

export function cooklangTextTransform(src: string): string {
  const fm = src.match(FRONTMATTER_RE)
  if (!fm?.[0] || !isCooklangFrontmatter(fm[1] ?? "")) return src

  const frontmatterBlock = fm[0]
  const body = src.slice(frontmatterBlock.length)
  return frontmatterBlock + transformBody(body)
}
