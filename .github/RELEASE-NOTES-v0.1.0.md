First public release of `readme-demo-recorder` — a scripted-flow browser demo recorder for Claude Code that turns a YAML demo-script into a polished MP4 + GIF ready for a README hero.

![hero](https://github.com/cjcsecurity/readme-demo-recorder/blob/main/docs/demos/tabletop-runbook.gif?raw=true)

## What's in this release

- **One-command pipeline** — `./skills/readme-demo-recorder/scripts/record.sh path/to/demo.yaml` produces MP4 + GIF in ~30 seconds.
- **YAML demo-script** with seven step types: `hold`, `wait`, `hover`, `click`, `scroll_to`, `type`, `mouse_park`. Selectors accept bare strings or `{ selector, nth }` for indexed matches.
- **Three cursor styles** — `pulse` (the catalyst look), `minimal` (small dot for typing-heavy demos), `crosshair` (precision feel for UI component spotlights). All configurable color + size.
- **Timed caption overlays** via ffmpeg `drawtext`. Captions burn into the MP4 and propagate to the GIF automatically. Default styling: monospace, white-on-semi-transparent-black, bottom third. Override via `caption_style`.
- **Automatic GIF size-cap auto-fit** via a 7-step quality ladder so a 60-second flow at 1280×720 lands under GitHub's 10 MB inline cap without manual intervention.
- **Three shipped examples** demonstrating different feature combinations — captions + clicks, typing-with-minimal-cursor, hover-click sequencing.
- **Phase 1 fallback** — hand-edit Node template at `references/playwright-template.md` for flows the YAML can't express.

## Try it

```bash
git clone https://github.com/cjcsecurity/readme-demo-recorder.git
cd readme-demo-recorder
export READMEDEMO_NODE_MODULES=/path/to/your/project/node_modules   # an existing playwright install
./skills/readme-demo-recorder/scripts/record.sh examples/shadcn-button/demo.yaml
# → docs/demos/shadcn-button.{mp4,gif}
```

See [INSTALL.md](https://github.com/cjcsecurity/readme-demo-recorder/blob/main/docs/INSTALL.md) for fresh-install paths, troubleshooting, and the Claude Code skill drop-in setup.

## Highlights from the build

- **`addInitScript` drops elements on `file://` loads** in headless Chromium. The cursor inject moved to `page.evaluate` after `goto`. Documented in [references/click-pulse-cursor.md](https://github.com/cjcsecurity/readme-demo-recorder/blob/main/skills/readme-demo-recorder/references/click-pulse-cursor.md#why-post-goto-evaluate-not-addinitscript).
- **`drawtext` with `textfile=`** sidesteps the ffmpeg filter escape nightmare. The driver writes each caption to a temp file rather than passing the string as an argv value, so any character (colons, commas, quotes, em-dashes, emoji) passes through unescaped.
- **The GIF size cascade drops width before fps** — area scaling is less perceptually painful than fps drops. Once below 720 px the ladder starts trading fps to avoid going below 540 px (text becomes unreadable).
- **The hero GIF is dogfood**: produced by this skill from this skill's own [`examples/tabletop-runbook.yaml`](https://github.com/cjcsecurity/readme-demo-recorder/blob/main/examples/tabletop-runbook.yaml).

## Catalyst

Built because [`claude-tabletop`](https://github.com/cjcsecurity/claude-tabletop) needed a polished README hero and the author kept hand-rolling the same Playwright + ffmpeg glue. The two skills are intentionally complementary — `claude-tabletop` generates a single-file HTML runbook, and `readme-demo-recorder` records a polished demo of that runbook (or any other HTML).

## What's next

- **v0.2** ideas (not committed): selector-wait steps (`wait_for_selector`), recording multiple targets and stitching them, SVG cursor sprites for custom branding, optional macOS-friendly install path.
- **Issues + PRs welcome** — [GitHub Issues](https://github.com/cjcsecurity/readme-demo-recorder/issues).

## Full changelog

See [CHANGELOG.md](https://github.com/cjcsecurity/readme-demo-recorder/blob/main/CHANGELOG.md).
