import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

// tsup's own esbuild plugin (see tsup.config.ts) transpiles `.inline.ts` into a
// browser-ready script string and compiles `.scss` to CSS at build time. Vitest
// doesn't go through that pipeline, so stub both as empty strings here — tests
// only assert on parsing/rendering logic, not the injected asset content.
const inlineAssetStub: Plugin = {
  name: "cooklang-inline-asset-stub",
  enforce: "pre",
  load(id) {
    if (id.endsWith(".inline.ts") || id.endsWith(".scss")) {
      return "export default ''";
    }
    return null;
  },
};

export default defineConfig({
  plugins: [inlineAssetStub],
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    reporters: ["default"],
  },
});
