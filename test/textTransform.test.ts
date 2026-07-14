import { describe, expect, it } from "vitest"
import {
  cooklangTextTransform,
  SECTION_SENTINEL_RE,
  TIMER_SENTINEL_RE,
  COOKWARE_MARKER,
  decodeSectionSentinelMatch,
  decodeTimerSentinelMatch,
} from "../src/textTransform"

function withFrontmatter(body: string, format = "cooklang"): string {
  return `---\nformat: ${format}\ntitle: Test\n---\n${body}`
}

describe("cooklangTextTransform — format detection", () => {
  it("leaves non-cooklang files untouched", () => {
    const src = withFrontmatter("== Section ==\n\nSome text.", "markdown")
    expect(cooklangTextTransform(src)).toBe(src)
  })

  it("leaves files with no frontmatter untouched", () => {
    const src = "== Section ==\n\nSome text."
    expect(cooklangTextTransform(src)).toBe(src)
  })

  it("detects unquoted format: cooklang", () => {
    const src = withFrontmatter("== Section ==")
    expect(cooklangTextTransform(src)).not.toBe(src)
  })

  it("detects quoted format: \"cooklang\"", () => {
    const src = `---\nformat: "cooklang"\ntitle: Test\n---\n== Section ==`
    expect(cooklangTextTransform(src)).not.toBe(src)
  })

  it("preserves the frontmatter block verbatim", () => {
    const src = withFrontmatter("Some text.")
    const result = cooklangTextTransform(src)
    expect(result.startsWith("---\nformat: cooklang\ntitle: Test\n---\n")).toBe(true)
  })
})

describe("cooklangTextTransform — comment stripping", () => {
  it("strips block comments [- ... -]", () => {
    const src = withFrontmatter("Mix well [- this is hidden -] now.")
    const result = cooklangTextTransform(src)
    expect(result).not.toContain("hidden")
  })

  it("strips inline comments to end of line", () => {
    const src = withFrontmatter("Mix well. -- this is a comment")
    const result = cooklangTextTransform(src)
    expect(result).toContain("Mix well.")
    expect(result).not.toContain("this is a comment")
  })

  it("deletes pure comment lines without leaving a blank-line break", () => {
    const src = withFrontmatter("-- section header\nline one\nline two")
    const result = cooklangTextTransform(src)
    const body = result.split("---\n").pop() ?? ""
    // No blank line should separate "line one" and "line two" — they must
    // remain one paragraph, matching today's "does not flush paragraph" rule.
    expect(body.trim()).toBe("line one\nline two")
  })
})

describe("cooklangTextTransform — section header sentinel", () => {
  it("encodes == Name == into a sentinel paragraph", () => {
    const src = withFrontmatter("== Pour la craquelin ==")
    const result = cooklangTextTransform(src)
    const body = result.split("---\n").pop() ?? ""
    const match = body.trim().match(SECTION_SENTINEL_RE)
    expect(match).not.toBeNull()
    expect(decodeSectionSentinelMatch(match!)).toBe("Pour la craquelin")
  })

  it("forces blank-line separation even without surrounding blank lines", () => {
    const src = withFrontmatter("Intro step.\n== Section ==\nSection step.")
    const result = cooklangTextTransform(src)
    const body = result.split("---\n").pop() ?? ""
    const lines = body.split("\n")
    const sentinelIdx = lines.findIndex((l) => SECTION_SENTINEL_RE.test(l))
    expect(sentinelIdx).toBeGreaterThan(0)
    expect(lines[sentinelIdx - 1]).toBe("")
    expect(lines[sentinelIdx + 1]).toBe("")
  })

  it("handles accented section names", () => {
    const src = withFrontmatter("== Crème pâtissière ==")
    const result = cooklangTextTransform(src)
    const body = result.split("---\n").pop() ?? ""
    const match = body.trim().match(SECTION_SENTINEL_RE)
    expect(decodeSectionSentinelMatch(match!)).toBe("Crème pâtissière")
  })
})

describe("cooklangTextTransform — timer sentinel", () => {
  it("encodes a named timer ~name{qty%unit}", () => {
    const src = withFrontmatter("Boil ~eggs{3%minutes}.")
    const result = cooklangTextTransform(src)
    const match = [...result.matchAll(TIMER_SENTINEL_RE)][0]
    expect(match).toBeDefined()
    expect(decodeTimerSentinelMatch(match!)).toEqual({ name: "eggs", quantity: "3", unit: "minutes" })
  })

  it("encodes an anonymous timer ~{qty%unit}", () => {
    const src = withFrontmatter("Cook for ~{25%minutes}.")
    const result = cooklangTextTransform(src)
    const match = [...result.matchAll(TIMER_SENTINEL_RE)][0]
    expect(decodeTimerSentinelMatch(match!)).toEqual({ name: null, quantity: "25", unit: "minutes" })
  })

  it("does not treat ~ mid-word as a timer", () => {
    const src = withFrontmatter("Dintérieur~=14 cm.")
    const result = cooklangTextTransform(src)
    expect(result).not.toMatch(TIMER_SENTINEL_RE)
    expect(result).toContain("Dintérieur~=14 cm.")
  })

  it("leaves a timer without a unit unencoded (invalid per spec)", () => {
    const src = withFrontmatter("Cook for ~{25}.")
    const result = cooklangTextTransform(src)
    expect(result).not.toMatch(TIMER_SENTINEL_RE)
    expect(result).toContain("~{25}")
  })

  it("does not corrupt an unrelated GFM strikethrough span", () => {
    const src = withFrontmatter("This isn't ~~important~~, just style.")
    const result = cooklangTextTransform(src)
    expect(result).toContain("~~important~~")
  })

  it("encodes two timers in the same paragraph independently", () => {
    const src = withFrontmatter("Boil ~eggs{3%minutes} then rest ~dough{2%hours}.")
    const result = cooklangTextTransform(src)
    const matches = [...result.matchAll(TIMER_SENTINEL_RE)].map(decodeTimerSentinelMatch)
    expect(matches).toEqual([
      { name: "eggs", quantity: "3", unit: "minutes" },
      { name: "dough", quantity: "2", unit: "hours" },
    ])
  })
})

describe("cooklangTextTransform — cookware # marker", () => {
  // Regression: `#cookware{}` collides with Obsidian's inline #tag syntax. Since
  // CooklangTransformer must run after ObsidianFlavoredMarkdown, an un-marked `#` would
  // already have been consumed into a tag node before this plugin ever sees it, leaving
  // raw cooklang syntax (`#poche à douille{}`) visible in the rendered page.
  it("marks a bare-word cookware reference", () => {
    const src = withFrontmatter("Preheat the #four{}.")
    const result = cooklangTextTransform(src)
    expect(result).toContain(`${COOKWARE_MARKER}four{}`)
    expect(result).not.toContain("#four")
  })

  it("marks a multi-word cookware reference", () => {
    const src = withFrontmatter("Verser dans une #poche à douille{}.")
    const result = cooklangTextTransform(src)
    expect(result).toContain(`${COOKWARE_MARKER}poche à douille{}`)
  })

  it("does not mark an ATX heading (# followed by a space)", () => {
    const src = withFrontmatter("# Heading\n\nSome text.")
    const result = cooklangTextTransform(src)
    expect(result).toContain("# Heading")
    expect(result).not.toContain(COOKWARE_MARKER)
  })

  it("does not mark a multi-hash ATX heading", () => {
    const src = withFrontmatter("## Notes\n\nSome text.")
    const result = cooklangTextTransform(src)
    expect(result).toContain("## Notes")
    expect(result).not.toContain(COOKWARE_MARKER)
  })
})
