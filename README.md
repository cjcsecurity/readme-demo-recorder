# readme-demo-recorder

> **Scripted-flow browser demo recorder for Claude Code.**
> YAML in. Polished MP4 + GIF out. Drop into a README hero.

<p align="center">
  <img src="docs/demos/tabletop-runbook.gif" alt="Demo: a captioned recording of a tabletop exercise runbook, produced from a 30-line YAML file by this skill itself." width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="docs/INSTALL.md"><img alt="Status: v0.1 ready" src="https://img.shields.io/badge/status-v0.1-green"></a>
  <img alt="Output: MP4 + GIF" src="https://img.shields.io/badge/output-MP4%20%2B%20GIF-orange">
  <img alt="Engine: Playwright + ffmpeg" src="https://img.shields.io/badge/engine-Playwright%20%2B%20ffmpeg-black">
  <a href="https://github.com/cjcsecurity/claude-tabletop"><img alt="Catalyst: claude-tabletop" src="https://img.shields.io/badge/catalyst-claude--tabletop-purple"></a>
</p>

## What it does

Hand it a single-file HTML target (or any URL) plus a YAML demo-script,
and it produces a polished MP4 + GIF ready for a README hero — visible
fake cursor, click pulse, optional timed captions, and an automatic
size-cap ladder so the GIF lands under GitHub's 10 MB inline cap.

The whole pipeline is one command:

```bash
./skills/readme-demo-recorder/scripts/record.sh path/to/demo.yaml
```

In ~30 seconds you get:

```
✓ mp4  1.62 MB  docs/demos/tabletop-runbook.mp4
✓ gif  5.21 MB  docs/demos/tabletop-runbook.gif  (960px @ 12fps)
```

The hero animation above is the dogfood: a 30-line YAML, three captions,
recorded by this skill against the
[`claude-tabletop`](https://github.com/cjcsecurity/claude-tabletop)
catalyst project's runbook.

## Why this exists

Building a polished README demo is a 50-line Playwright + ffmpeg pipeline
that bakes in a handful of not-so-obvious details — cursor injection that
survives `file://` loads, drawtext with `textfile=` to avoid escape hell,
palettegen with `stats_mode=diff` for clean GIFs. This skill makes it a
1-command operation.

The niche it fills is deliberately narrow: **Claude Code skill demos
where the artifact is a single-file HTML target**, with auto-fit logic
tuned for GitHub's specific 10 MB inline-rendering cap and a
`file://`-first workflow. For general product-demo recording with macOS
chrome, branding, zoom, and a richer cursor toolkit, the better-engineered
generalists are [`webreel`](https://github.com/vercel-labs/webreel) and
[`testreel`](https://github.com/greentfrapp/testreel). For the narrow
case of "I just shipped a Claude skill that produces a self-contained
HTML artifact and want its README hero produced by another Claude skill,"
this is the right fit.

For the full backstory and design decisions, see [`PLAN.md`](PLAN.md).

## Quickstart

```bash
# 1. Clone alongside an existing Playwright install (see docs/INSTALL.md
#    for fresh-install instructions).
git clone https://github.com/cjcsecurity/readme-demo-recorder.git
cd readme-demo-recorder
export READMEDEMO_NODE_MODULES=/path/to/your/project/node_modules

# 2. Author a YAML somewhere — anywhere.
cat > my-demo.yaml <<'EOF'
target: ./your-app/index.html
flow:
  - mouse_park: { x: 0.5, y: 0.4 }
  - hold: 1500
  - click: '#start'
  - wait: 2200
  - type:
      selector: '#search'
      text: 'Hello, world'
      delay_ms: 28
  - wait: 1500

cursor:
  style: pulse        # pulse | minimal | crosshair

output:
  dir: 'docs/demos/'
  basename: 'my-demo'
EOF

# 3. Record it.
./skills/readme-demo-recorder/scripts/record.sh my-demo.yaml
# → docs/demos/my-demo.mp4 + docs/demos/my-demo.gif
```

## Examples

| Demo                                      | Cursor    | Showcases                                  |
|-------------------------------------------|-----------|--------------------------------------------|
| [`tabletop-runbook`](examples/tabletop-runbook.yaml) | `pulse`     | Captions + click + scroll + nth-selector   |
| [`form-submission`](examples/form-submission/demo.yaml) | `minimal`   | Typing into form fields + dark theme       |
| [`shadcn-button`](examples/shadcn-button/demo.yaml)    | `crosshair` | Hover sequencing + light theme             |

Walkthrough: [**`docs/EXAMPLES.md`**](docs/EXAMPLES.md).

## Docs map

| File                                                                                                              | What it covers                                                                 |
|-------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| [`docs/INSTALL.md`](docs/INSTALL.md)                                                                              | Prerequisites, three install paths, smoke test, troubleshooting.               |
| [`docs/EXAMPLES.md`](docs/EXAMPLES.md)                                                                            | Walkthrough of each shipped example with output GIFs.                          |
| [`skills/readme-demo-recorder/SKILL.md`](skills/readme-demo-recorder/SKILL.md)                                    | Claude-facing skill instructions — workflow, defaults, failure modes.          |
| [`.../references/demo-script-format.md`](skills/readme-demo-recorder/references/demo-script-format.md)            | Full YAML schema: every step type, every field, validation rules, pitfalls.    |
| [`.../references/click-pulse-cursor.md`](skills/readme-demo-recorder/references/click-pulse-cursor.md)            | Cursor injection recipe: CSS+JS for each style, the `addInitScript` gotcha.    |
| [`.../references/ffmpeg-pipeline.md`](skills/readme-demo-recorder/references/ffmpeg-pipeline.md)                  | Encoding flags, two-pass GIF palette, the size-cap auto-fit ladder.            |
| [`.../references/playwright-template.md`](skills/readme-demo-recorder/references/playwright-template.md)          | Hand-edit Node template — fallback for flows the YAML can't express.           |

## How it works

1. **Playwright** launches headless Chromium at 1280×720 with `recordVideo`.
2. **Cursor inject** runs after `page.goto` (not `addInitScript` — that
   silently drops elements on `file://` loads). Three styles to choose from:
   `pulse`, `minimal`, `crosshair`. Pure CSS+JS, no external dependencies.
3. **Flow** drives the page from the YAML steps — `hover`, `click`,
   `scroll_to`, `type`, `mouse_park`, `wait` — using a smooth-glide
   `mouse.move(x, y, { steps: 22 })` so the cursor reads as a person.
4. **ffmpeg** encodes WebM → MP4 (`libx264`, `crf 22`, `+faststart`,
   `yuv420p`) and burns in any captions via `drawtext` with `textfile=`
   (no escape hell).
5. **GIF cascade** re-encodes the captioned MP4 through a 7-step quality
   ladder (`960×12fps` → … → `540×8fps`), stopping at the first step
   that fits `output.gif_max_mb`.
6. **Outputs** land at `<output.dir>/<output.basename>.{mp4,gif}` along
   with a one-line per-format summary on stderr.

## License

[Apache-2.0](LICENSE).

## Catalyst

This skill exists because [`claude-tabletop`](https://github.com/cjcsecurity/claude-tabletop)
needed a polished README hero, and the author hit the same Playwright +
ffmpeg glue every time they wanted a demo. The technique here is the same
one that produced `claude-tabletop`'s `runbook-demo.{mp4,gif}` — extracted,
generalized, and wrapped in a YAML-driven driver.
