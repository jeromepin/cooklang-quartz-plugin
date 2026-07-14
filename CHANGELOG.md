# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Breaking:** CookLang recipes are now parsed additively on top of GitHub-Flavored and
  Obsidian-Flavored Markdown instead of bypassing Markdown parsing entirely. Tables,
  footnotes, task lists, images, callouts, and wiki-links/embeds now work inside step text,
  ingredient names, and prep notes.
- **Breaking:** wiki-link resolution (`[[target]]`) is delegated entirely to Quartz's own
  `ObsidianFlavoredMarkdown` transformer. `CooklangTransformer` must now be registered
  *after* `GitHubFlavoredMarkdown`/`ObsidianFlavoredMarkdown` in `quartz.config.ts` — see
  README.md.

### Added

- Initial Quartz community plugin template.
