import { describe, expect, it } from "vitest";
import { toHtml } from "hast-util-to-html";
import { buildRecipeHast } from "../src/renderer";
import { GroupedQuantity, parseNumber } from "../src/quantity";
import { parseQuantity } from "../src/parser";
import { parseCooklangFixture, withCooklangFrontmatter } from "./helpers";

function render(body: string): string {
  const { recipe } = parseCooklangFixture(withCooklangFrontmatter(body));
  return toHtml(buildRecipeHast(recipe, {}, "en") as never);
}

// One "name: quantities" string per ingredient-list entry, in order, e.g. "carottes: 13".
function listed(body: string): string[] {
  const html = render(body);
  const lists = [...html.matchAll(/<ul class="ing-list">([\s\S]*?)<\/ul>/g)].map((m) => m[1]!);
  return lists.flatMap((list) =>
    [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((li) => {
      const text = li[1]!.replace(/<span class="ing-qty">/, ": ").replace(/<[^>]+>/g, "");
      return text.trim();
    }),
  );
}

function group(...specs: string[]): string {
  const g = new GroupedQuantity();
  for (const spec of specs) {
    const { quantity, unit } = parseQuantity(spec);
    g.add(quantity, unit);
  }
  return g
    .toList()
    .map(({ value, unit }) => {
      const v =
        value.kind === "number"
          ? String(value.value)
          : value.kind === "range"
            ? `${value.low}-${value.high}`
            : value.value;
      return unit ? `${v} ${unit}` : v;
    })
    .join(", ");
}

describe("GroupedQuantity (cooklang-rs grouping rules)", () => {
  it("sums unitless quantities", () => expect(group("1", "12")).toBe("13"));
  it("sums identical units", () => expect(group("200%g", "300%g")).toBe("500 g"));
  it("converts compatible units and fits the total", () =>
    expect(group("1000%g", "200%g", "1%bag")).toBe("1.2 kg, 1 bag"));
  it("fits down when the total is below 1 of the first unit", () =>
    expect(group("0.5%kg", "200%g")).toBe("700 g"));
  it("converts volumes case-insensitively", () => expect(group("50%cL", "1%L")).toBe("1.5 L"));
  it("keeps the first unit when units are identical", () =>
    expect(group("25%cL", "50%cL")).toBe("75 cL"));
  it("sums unknown units only with the exact same text", () =>
    expect(group("1%c.à.s", "2%c.à.s", "1%c.à.c")).toBe("3 c.à.s, 1 c.à.c"));
  it("keeps unit and no-unit quantities apart", () => expect(group("1", "100%g")).toBe("1, 100 g"));
  it("adds a number to both ends of a range", () =>
    expect(group("100%g", "200-400%g")).toBe("300-500 g"));
  it("never sums text values", () => expect(group("un peu", "1%g")).toBe("1 g, un peu"));
  it("ignores missing quantities", () => expect(group("", "2")).toBe("2"));
  it("parses fractions", () => expect(group("1/2", "1/4")).toBe("0.75"));
  it("parseNumber rejects free text", () => expect(parseNumber("un peu")).toBeNull());
});

describe("ingredient references in the ingredient list", () => {
  it("adds an @& reference's quantity to its definition", () => {
    expect(listed("Add @carottes{1}.\n\nThen add @&carottes{12} and @chou{1}.")).toEqual([
      "carottes: 13",
      "chou: 1",
    ]);
  });

  it("resolves references to a definition from an earlier section", () => {
    const body =
      "== Bouillon ==\n\nAdd @carottes{1}.\n\n== Garniture ==\n\nAdd @&carottes{12} and @chou{1}.";
    expect(listed(body)).toEqual(["carottes: 13", "chou: 1"]);
    const html = render(body);
    const garniture = html.slice(
      html.indexOf('id="ing-garniture"'),
      html.indexOf('id="instructions"'),
    );
    expect(garniture).not.toContain("carottes");
  });

  it("references the last definition when several exist", () => {
    expect(listed("Add @oeufs{2}.\n\nAdd @oeufs{3}.\n\nAdd @&oeufs{1}.")).toEqual([
      "oeufs: 2",
      "oeufs: 4",
    ]);
  });

  it("matches names case-insensitively and ignores preparation notes", () => {
    expect(listed("Add @Carottes (en rondelles){1}.\n\nAdd @&carottes{2}.")).toEqual([
      "Carottes (en rondelles): 3",
    ]);
  });

  it("keeps incompatible units side by side", () => {
    expect(listed("Add @farine{1%kg}.\n\nAdd @&farine{200%g} and @&farine{1%sachet}.")).toEqual([
      "farine: 1.2 kg, 1 sachet",
    ]);
  });

  it("treats a reference without an earlier definition as a definition", () => {
    expect(listed("Add @&sel{1%g}.")).toEqual(["sel: 1 g"]);
  });

  it("merges into hidden definitions without listing them", () => {
    expect(listed("Add @-secret{1%g} and @&secret{2%g}.")).toEqual([]);
  });

  it("does not list nor merge intermediate preparations", () => {
    expect(listed("Make the @dough{1}.\n\nLet the @&(~1)dough{} rest.")).toEqual(["dough: 1"]);
    expect(listed("Let the @&(=1)pâte{2} rest.")).toEqual([]);
  });

  it("keeps same-named ingredients separate by default", () => {
    expect(listed("Add @water{1}.\n\nAdd @water{2}.")).toEqual(["water: 1", "water: 2"]);
  });

  it("[duplicate: ref] makes same-named ingredients implicit references", () => {
    expect(listed("[duplicate: ref]\n\nAdd @water{1}.\n\nAdd @water{2}.")).toEqual(["water: 3"]);
  });

  it("[duplicate: ref] does not link optional and required ingredients", () => {
    expect(listed("[duplicate: ref]\n\nAdd @parmesan{100%g} and @?parmesan{50%g}.")).toHaveLength(
      2,
    );
  });

  it("[duplicate: ref] still creates a new ingredient with @+", () => {
    expect(listed("[duplicate: ref]\n\nAdd @water{1}.\n\nAdd @+water{2}.")).toEqual([
      "water: 1",
      "water: 2",
    ]);
  });

  it("[mode: steps] merges into earlier definitions", () => {
    expect(listed("Add @flour{200%g}.\n\n[mode: steps]\n\nAdd @flour{100%g}.")).toEqual([
      "flour: 300 g",
    ]);
  });
});

describe("quantity rendering", () => {
  it("displays the original spelling of an unmerged fraction but scales from its value", () => {
    const html = render("Add @sucre{1/2%kg}.");
    expect(html).toContain('class="scalable-value" data-base="0.5">1/2<');
  });

  it("renders free-text quantities as non-scalable", () => {
    const html = render("Add @sel{un peu}.");
    expect(html).toContain('class="text-value">un peu<');
    expect(html).not.toContain("scalable-value");
  });

  it("renders each grouped quantity as its own scalable value", () => {
    const html = render("Add @farine{1%kg}.\n\nAdd @&farine{1%sachet}.");
    expect(html).toContain(
      'data-base="1">1</span> <span class="unit">kg</span>, <span class="scalable-value" data-base="1">',
    );
  });
});
