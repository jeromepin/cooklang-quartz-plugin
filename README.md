# Quartz Cookland Plugin

> [!note]
> Beside what was provided by the template, everything else was written by Claude because I don't know JS/TS at all

Production-ready template for building, testing, and publishing Quartz community plugins. It mirrors
Quartz's native plugin patterns and uses a factory-function API similar to Astro integrations:
plugins are created by functions that return objects with `name` and lifecycle hooks.

## Highlights

- ✅ Quartz-compatible transformer plugin (CookLang recipes on top of GFM/Obsidian Markdown)
- ✅ TypeScript-first with exported types for consumers
- ✅ `tsup` bundling + declaration output
- ✅ Pre-built `dist/` ships in the repo — instant installation for users
- ✅ Vitest testing setup with example tests
- ✅ Linting/formatting with ESLint + Prettier
- ✅ CI workflow for checks and npm publishing
- ✅ Demonstrates CSS/JS resource injection and remark/rehype usage

## Getting started

```bash
npm install
npm run build
```

> [!important]
> After building, the `dist/` directory should be committed to the repository. It is not gitignored, as Quartz uses it for pre-built distribution.

## Build and Distribution

The template is configured to bundle all dependencies by default via `noExternal: [/.*/]` in `tsup.config.ts`. This ensures that users don't need to install any dependencies when using your plugin.

- **Singleton Externals**: Certain packages (`vfile`, `unified`, `@jackyzha0/quartz`) are kept external to ensure only one instance of them exists across all plugins.
- **Native Dependencies**: If your plugin uses native dependencies (like `sharp`, `@napi-rs/simple-git`, etc.), you must exclude them from bundling. Use a regex pattern in `noExternal` to exclude them, for example: `noExternal: [/^(?!sharp)/]`.
- **CI Verification**: The included CI workflow verifies that `dist/` is up to date on every push.

## Usage in Quartz

Install your plugin into a Quartz v5 site:

```bash
npx quartz plugin add github:quartz-community/plugin-template
```

Then register it in `quartz.config.yaml`:

```yaml
plugins:
  - source: github:quartz-community/plugin-template
    enabled: true
    options:
      highlightToken: "=="
```

If you need to use the plugin in `quartz.ts` for advanced overrides:

```ts
import * as ExternalPlugin from "./.quartz/plugins";

export default {
  plugins: {
    transformers: [ExternalPlugin.CooklangTransformer()],
  },
};
```

## CookLang Recipes

`CooklangTransformer` renders `.md` files whose frontmatter has `format: cooklang` as recipe
pages: a servings-scalable metadata row, a deduplicated cookware list, and per-section
ingredient lists and numbered instructions, extracted from `@ingredient{qty%unit}`,
`#cookware{}`, `~timer{qty%unit}`, and `== Section ==` syntax.

Everything else in the file is parsed as regular Markdown — GFM (tables, footnotes, task
lists) and Obsidian-flavored syntax (wiki-links, embeds, callouts, highlights) all work
inside step text, ingredient names, and prep notes, exactly as on any other note.

**Setup requirement:** register `CooklangTransformer` *after* `GitHubFlavoredMarkdown` and
`ObsidianFlavoredMarkdown` in `quartz.config.ts`, since it reads the mdast tree those
transformers have already produced rather than parsing raw Markdown itself:

```ts
import { CooklangTransformer } from "@quartz-community/cooklang";

transformers: [
  Plugin.FrontMatter(),
  Plugin.ObsidianFlavoredMarkdown({ enableInHtmlEmbed: false }),
  Plugin.GitHubFlavoredMarkdown(),
  CooklangTransformer(),
  // ...
];
```

See `AGENTS.md`'s "CookLang Plugin — Design Specification" section for the full syntax
reference, data model, and known content quirks.

## Plugin factory pattern (Astro-style)

Quartz plugins are factory functions that return an object with a `name` and hook implementations.
This mirrors Astro's integration pattern (a function returning an object of hooks), which makes
composition and configuration explicit and predictable.

```ts
import type { QuartzTransformerPlugin } from "@quartz-community/types";

export const MyTransformer: QuartzTransformerPlugin<{ enabled: boolean }> = (opts) => {
  return {
    name: "MyTransformer",
    markdownPlugins() {
      return [];
    },
  };
};
```

## Testing

```bash
npm test
```

## Build and lint

```bash
npm run build
npm run lint
npm run format
```

## Publishing

Tags matching `v*` trigger the GitHub Actions publish workflow. Ensure `NPM_TOKEN` is set in the
repository secrets.

## Component Plugins (UI Components)

In addition to transformer/filter/emitter plugins, Quartz also supports **component plugins**
that provide UI elements for Quartz layouts (this repo doesn't currently ship one — the pattern
below is a reference for building one).

### Component Pattern

```tsx
import type { QuartzComponent, QuartzComponentConstructor } from "@quartz-community/types";
import style from "./styles/my-component.scss";
import script from "./scripts/my-component.inline.ts";

export default ((opts?: MyComponentOptions) => {
  const Component: QuartzComponent = (props) => {
    return <div class="my-component">...</div>;
  };

  Component.css = style;
  Component.afterDOMLoaded = script;

  return Component;
}) satisfies QuartzComponentConstructor;
```

### Receiving YAML Options in Component-Only Plugins

Processing plugins (transformers, filters, emitters, page types) receive options automatically
through their factory function. **Component-only plugins** (those with `"category": ["component"]`)
are loaded via side-effect import and need an extra step to receive YAML options.

Export an `init` function from your plugin's entry point. Quartz's config-loader will call it with
the merged options from `package.json` `defaultOptions` and the user's `quartz.config.yaml`:

```ts
// src/index.ts
export function init(options?: Record<string, unknown>): void {
  // Use the options to configure your plugin
  const myOption = (options?.myOption as boolean) ?? false;
  // e.g. register a view, set global state, etc.
}
```

Then declare default values in your `package.json` manifest:

```json
{
  "quartz": {
    "category": ["component"],
    "defaultOptions": {
      "myOption": false
    }
  }
}
```

Users configure options in `quartz.config.yaml`:

```yaml
plugins:
  - source: github:your-username/my-component-plugin
    enabled: true
    options:
      myOption: true
```

Quartz merges `defaultOptions` with the user's `options` (user values take precedence) and passes
the result to `init()`. If no `init` export exists, the plugin is loaded via side-effect import as
before — no breaking change for existing plugins.

### Client-Side Scripts

Component scripts run in the browser and must handle Quartz's SPA navigation. Key patterns:

1. **Use `@ts-nocheck`** - Client scripts run in a different context than build-time code
2. **Listen to `nav` event** - Fires after each page navigation (including initial load)
3. **Listen to `prenav` event** - Fires before navigation, use for saving state
4. **Use `window.addCleanup()`** - Register cleanup functions for event listeners
5. **Use `fetchData` global** - Access page metadata via the `fetchData` promise (handles base path correctly)

See `src/components/scripts/recipe.inline.ts` for a real example following these patterns
(servings-scaling for CookLang recipes).

### Common Helper Functions

These utilities are commonly needed in component plugins:

```js
function removeAllChildren(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function simplifySlug(slug) {
  return slug.endsWith("/index") ? slug.slice(0, -6) : slug;
}

function getCurrentSlug() {
  let slug = window.location.pathname;
  if (slug.startsWith("/")) slug = slug.slice(1);
  if (slug.endsWith("/")) slug = slug.slice(0, -1);
  return slug || "index";
}
```

### State Persistence

Use `localStorage` for persistent state (survives browser close) and `sessionStorage` for
temporary state (like scroll positions):

```js
localStorage.setItem("myPlugin-state", JSON.stringify(state));
sessionStorage.setItem("myPlugin-scrollTop", element.scrollTop.toString());
```

## Migration Guide (from Quartz v4)

When migrating a v4 component to a standalone plugin:

1. **Replace Quartz imports** with `@quartz-community/types`
2. **Copy utility functions** (path helpers, DOM utils) into your plugin
3. **Use `@ts-nocheck`** for inline scripts that can't be type-checked
4. **Use the `fetchData` global** to access `contentIndex.json` with the correct base path
5. **Test with both local and production builds**

## License

MIT
