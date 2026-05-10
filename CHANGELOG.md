# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(Nothing yet.)

## [0.1.0] — 2026-05-10

Initial public release.

### Added

- **YAML-driven demo recorder** at `skills/readme-demo-recorder/scripts/record.mjs` — single command (`record.sh path/to/demo.yaml`) drives Playwright headless Chromium with `recordVideo`, runs ffmpeg, and writes MP4 + GIF to the configured output directory.
- **Seven flow step types**: `hold`, `wait`, `hover`, `click`, `scroll_to`, `type`, `mouse_park`. Selectors accept bare strings or `{ selector, nth }` to avoid the CSS `:nth-of-type` trap.
- **Three cursor styles**: `pulse` (default — white circle, dark ring, blue pulse on click), `minimal` (small solid dot, scale-down on click, no pulse), `crosshair` (perpendicular lines with color-flash on click). All configurable via `cursor.color`, `cursor.pulse_color`, `cursor.size`.
- **Timed caption overlays** via ffmpeg `drawtext`, burned into the MP4 and propagated to the GIF cascade. Caption text is written to a temp file and referenced via `textfile=` so colons, commas, quotes, em-dashes, and emoji pass through unescaped. Optional `caption_style` block for font/size/color/position overrides; defaults to DejaVu Sans Mono at 26 px, white on semi-transparent black, bottom third.
- **Automatic GIF size-cap enforcement** via a 7-step quality ladder: `960×12fps` → `800×12` → `720×12` → `720×10` → `640×10` → `640×8` → `540×8`. The driver stops at the first step that fits `output.gif_max_mb` (default 10 MB). If even the smallest step exceeds the cap, ships the smallest attempt and warns.
- **Three shipped examples** demonstrating distinct feature combinations:
  - `examples/tabletop-runbook.yaml` — captions + click + scroll, recorded against the catalyst project's tabletop exercise runbook.
  - `examples/form-submission/{index.html,demo.yaml}` — typing into form fields with the `minimal` cursor on a dark theme.
  - `examples/shadcn-button/{index.html,demo.yaml}` — hover + click sequencing across a button family with the `crosshair` cursor on a light theme.
- **Phase 1 fallback path** at `skills/readme-demo-recorder/references/playwright-template.md` — a hand-edit Node template for flows the YAML schema can't express. Skip the driver, copy the template, edit the `// === FLOW ===` block, run.
- **Documentation**: full YAML schema (`references/demo-script-format.md`), cursor injection recipe (`references/click-pulse-cursor.md`), ffmpeg pipeline + ladder (`references/ffmpeg-pipeline.md`), install guide (`docs/INSTALL.md`), example walkthrough (`docs/EXAMPLES.md`).

### Notes

- **Cursor inject runs after `page.goto`, not via `addInitScript`**. `addInitScript` silently drops elements appended to `document.documentElement` on `file://` loads in headless Chromium — the `window`-scoped install flag persists but the DOM tree gets swapped when the parser starts. Discovered during Phase 1; documented in `references/click-pulse-cursor.md`.
- **ESM module resolution ignores `NODE_PATH`**. The `record.sh` wrapper creates a `node_modules` symlink next to the driver (configurable via `READMEDEMO_NODE_MODULES`) so the ESM resolver finds Playwright and js-yaml without needing the driver to live inside a Node project.
- **Hero GIF** at `docs/demos/tabletop-runbook.gif` was produced by this skill from this skill's own example YAML — dogfooded.
