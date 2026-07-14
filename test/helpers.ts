import type {
  BuildCtx,
  FilePath,
  FullSlug,
  QuartzConfig,
  ProcessedContent,
  QuartzPluginData,
} from "@quartz-community/types";
import { isFilePath, isFullSlug } from "@quartz-community/utils";
import { VFile } from "vfile";
import { unified } from "unified";
import type { Plugin } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { CooklangTransformer } from "../src/transformer";
import type { CooklangRecipe } from "../src/types";

type BuildCtxOverrides = Omit<Partial<BuildCtx>, "argv"> & {
  argv?: Partial<BuildCtx["argv"]>;
};

export const createCtx = (overrides: BuildCtxOverrides = {}): BuildCtx => {
  const { argv: argvOverrides, ...rest } = overrides;
  const argv: BuildCtx["argv"] = {
    directory: "content",
    verbose: false,
    output: "dist",
    serve: false,
    watch: false,
    port: 0,
    wsPort: 0,
    ...argvOverrides,
  };

  return {
    buildId: "test-build",
    argv,
    cfg: {} as QuartzConfig,
    allSlugs: [],
    allFiles: [],
    incremental: false,
    ...rest,
  };
};

export const createProcessedContent = (data: Partial<QuartzPluginData> = {}): ProcessedContent => {
  const vfile = new VFile("");
  vfile.data = data;
  return [{ type: "root", children: [] }, vfile];
};

export const assertFilePath = (value: string): FilePath => {
  if (!isFilePath(value)) {
    throw new Error(`Invalid FilePath: ${value}`);
  }
  return value;
};

export const assertFullSlug = (value: string): FullSlug => {
  if (!isFullSlug(value)) {
    throw new Error(`Invalid FullSlug: ${value}`);
  }
  return value;
};

export function withCooklangFrontmatter(body: string): string {
  return `---\nformat: cooklang\ntitle: Test\n---\n${body}`;
}

// Runs the real textTransform -> remark(gfm) -> cooklang-remark pipeline and returns the
// resulting file.data.cooklang. `rawSrcWithFrontmatter` must include a `format: cooklang`
// frontmatter block (see withCooklangFrontmatter) since detection happens on raw text.
// `frontmatterOverrides` simulates fields Quartz's own FrontMatter transformer would have
// already parsed onto file.data.frontmatter by the time this plugin's remark stage runs.
export function parseCooklangFixture(
  rawSrcWithFrontmatter: string,
  frontmatterOverrides: Record<string, unknown> = {},
  ctxOverrides: BuildCtxOverrides = {},
): { file: VFile; recipe: CooklangRecipe } {
  const transformer = CooklangTransformer();
  const ctx = createCtx(ctxOverrides);

  const transformed = transformer.textTransform!(ctx, rawSrcWithFrontmatter);
  const fmMatch = transformed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const body = fmMatch ? transformed.slice(fmMatch[0].length) : transformed;

  const file = new VFile(body);
  file.data.frontmatter = { format: "cooklang", title: "Test", ...frontmatterOverrides };

  let processor = unified().use(remarkParse).use(remarkGfm);
  for (const plugin of transformer.markdownPlugins!(ctx)) {
    processor = processor.use(plugin as Plugin) as unknown as typeof processor;
  }

  const tree = processor.parse(file);
  processor.runSync(tree, file);

  if (!file.data.cooklang) throw new Error("expected file.data.cooklang to be set");
  return { file, recipe: file.data.cooklang };
}

// Full pipeline: raw source -> textTransform -> remark(gfm) -> cooklang-remark ->
// cooklang-rehype, returning the final rendered hast tree via the plugin's own htmlPlugins
// hook (rather than calling buildRecipeHast directly, as renderer.test.ts does).
export function renderCooklangFixture(
  rawSrcWithFrontmatter: string,
  frontmatterOverrides: Record<string, unknown> = {},
  ctxOverrides: BuildCtxOverrides = {},
) {
  const transformer = CooklangTransformer();
  const ctx = createCtx(ctxOverrides);
  const { file } = parseCooklangFixture(rawSrcWithFrontmatter, frontmatterOverrides, ctxOverrides);

  const hastTree: { type: "root"; children: unknown[] } = { type: "root", children: [] };
  const rehypePlugin = (transformer.htmlPlugins!(ctx)[0] as () => (tree: typeof hastTree, file: VFile) => void)();
  rehypePlugin(hastTree, file);

  return hastTree;
}
