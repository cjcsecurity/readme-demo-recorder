# readme-demo-recorder — build plan

> **Status**: scaffolded, not yet built. This document is the spec another Claude Code session will execute.
>
> **Created**: 2026-05-07 from `~/projects/claude-tabletop/` build session, where the gap was identified after the user shipped `claude-tabletop` and needed a way to record a polished README demo. The technique used there (Playwright `recordVideo` + ffmpeg WebM→MP4→GIF + injected fake cursor with click pulse) is the direct prior art and reference implementation.

## 1. Why this exists

There's a real gap in the Claude Code skill ecosystem and the broader open-source landscape:

- **Existing motion skills** (`hyperframes`, `motion-frames`, `sprite-animation` in `~/tools/open-design/skills/`) author motion graphics from scratch. They don't capture a live app.
- **Existing screenshot skills** produce single frames.
- **`livlign/claude-skills`'s `repo-visuals`** designs bespoke README heroes through a discovery dialog. It doesn't record an existing app's user flow.
- **No SaaS competitor** does scripted-flow browser demo recording cleanly. Charm.sh's `vhs` is the closest analogue but is terminal-only.

The gap: **"scripted-flow browser demo recorder for README hero assets"** is a horizontal need — every Claude Code skill that ships visual output benefits from a polished demo gif/mp4. Today, building one is a 50-line Playwright script + ffmpeg pipeline glued together by hand. This skill makes it a 1-command operation.

The user just shipped `claude-tabletop` and went through this exact glue process manually. The output (`~/projects/claude-tabletop/docs/demos/runbook-demo.{mp4,gif}`) is the proof-of-concept reference for what this skill should produce automatically.

## 2. What this skill does

**Input**:
- Path to single-file HTML (or URL)
- A YAML "demo script" declaring the user-flow (selectors, delays, captions, viewport)

**Output** (default: `docs/demos/<basename>.{mp4,gif}`):
- MP4 at 1280×720, H.264, optimized for inline GitHub README rendering
- GIF at ~960×540, 12fps, capped under GitHub's 10 MB README asset limit
- Both injected with a visible fake cursor that pulses on each click

**Side-effect goals**:
- Reproducibility — same YAML produces equivalent output (modulo Playwright timing jitter)
- Offline-capable — no CDN dependencies, no external font loads
- Out-of-the-box polish — defaults look like a portfolio, not a tech demo

## 3. User stories (V1)

1. **As a Claude Code skill author** who just shipped a single-file HTML artifact, I want to record a 20-30s demo of it for the README hero, with one command.
2. **As a portfolio builder**, I want consistent demo aesthetics across my projects so my profile reads as a coherent body of work.
3. **As a contributor to my own skill**, I want demo flows to be reproducible — re-record the same flow after a UI change, get an updated demo with the same beats.

## 4. Functional requirements

### 4.1 Demo-script YAML format

Declarative, not code. Schema lives at `skills/readme-demo-recorder/references/demo-script-format.md` (write this in Phase 2):

```yaml
target: file:///path/to/index.html      # or https://...
viewport: { width: 1280, height: 720 }
duration_target_seconds: 25              # soft target; encoder respects exact length

flow:
  - hold: 1500                          # ms — wait, do nothing visually
  - hover: '#startBtn'                  # cursor moves to selector center
  - click: '#startBtn'                  # cursor moves + clicks (with pulse)
  - wait: 2400                          # passive wait (e.g. let timer tick)
  - scroll_to: '#phase-1'               # smooth scroll to selector
  - hover: '.reveal-btn:nth-of-type(1)'
  - click: '.reveal-btn:nth-of-type(1)'
  - type:
      selector: '#decisionLogBody tr:last-child td:nth-child(2) textarea'
      text: 'Declared SEV-2 — token theft confirmed'
      delay_ms: 28                      # per-keystroke delay

captions:                               # optional — drawtext overlay
  - at_ms: 5000
    text: 'Click Start to begin'
    duration_ms: 2500
  - at_ms: 12000
    text: 'Reveal injects in sequence'
    duration_ms: 2500

cursor:
  style: pulse                          # pulse | minimal | crosshair
  color: '#ffffff'
  pulse_color: '#58a6ff'

output:
  dir: 'docs/demos/'
  basename: 'my-app-demo'
  formats: [mp4, gif]                   # subset
  gif_max_mb: 10                        # auto-downscale to fit
```

### 4.2 Cursor rendering

Reuse the technique from the claude-tabletop demo recording. Inject via Playwright `addInitScript`:

- Fake cursor element follows `mousemove` events
- Click triggers a brief expanding ring + scale-down on the cursor itself
- All CSS+JS embedded; no external dependencies
- Configurable via the `cursor` block in the YAML

Reference implementation: `~/projects/claude-tabletop/`'s recording session used a working version of this (now deleted, but reproducible from the techniques in `references/click-pulse-cursor.md` once written).

### 4.3 Output pipeline

Three stages:

1. **Playwright `recordVideo`** at native viewport size → WebM
2. **WebM → MP4** via ffmpeg with `libx264`, `crf 22-23`, `+faststart`, `pix_fmt yuv420p`
3. **MP4 → GIF** via two-pass ffmpeg: `palettegen=stats_mode=diff:max_colors=128` then `paletteuse=dither=bayer:bayer_scale=5`. If output exceeds `gif_max_mb`, auto-downscale (try 960px → 720px → 640px) and reduce fps (15 → 12 → 10) until under cap.

### 4.4 Defaults

| Setting | Default | Rationale |
|---|---|---|
| Viewport | 1280×720 | GitHub README rendering sweet spot |
| MP4 fps | 24 | Smooth cursor motion |
| GIF fps | 12 | Balance smoothness vs file size |
| GIF max width | 960px | First-pass cap before downsizing |
| Output dir | `docs/demos/` | Matches claude-tabletop convention |
| Cursor style | pulse | Most visible at small sizes |

### 4.5 Quality bar

- Same YAML produces equivalent output across runs
- Output looks polished out-of-the-box (no ugly default cursor, no black flash frames)
- Works offline / in SCIF
- Graceful failure on missing selectors (warn + skip the step, don't crash mid-recording)
- Final MP4 + GIF both pass `ffprobe` validation

## 5. Folder structure (already scaffolded)

```
readme-demo-recorder/
├── README.md                              ← TODO: project README, banner, badges
├── LICENSE                                ← Apache-2.0 (matches claude-tabletop)
├── .gitignore                             ← already in place
├── PLAN.md                                ← THIS FILE
├── docs/
│   ├── INSTALL.md                         ← TODO Phase 6
│   └── EXAMPLES.md                        ← TODO Phase 6 (3 walkthroughs)
├── examples/                              ← user-facing example YAMLs
│   ├── tabletop-runbook.yaml              ← TODO: re-record claude-tabletop demo via this skill (dogfood)
│   ├── form-submission.yaml               ← TODO: simple form demo
│   └── shadcn-button.yaml                 ← TODO: tiny UI demo
└── skills/
    └── readme-demo-recorder/
        ├── SKILL.md                       ← TODO Phase 1: workflow + flag parsing
        ├── references/
        │   ├── demo-script-format.md      ← TODO Phase 2: full YAML schema spec
        │   ├── playwright-template.md     ← TODO Phase 1: Node script template
        │   ├── ffmpeg-pipeline.md         ← TODO Phase 1: encoding presets
        │   ├── click-pulse-cursor.md      ← TODO Phase 3: cursor inject CSS+JS
        │   └── github-readme-asset-rules.md ← TODO Phase 4: size caps, MP4 vs GIF tradeoffs
        └── assets/                        ← any default cursor SVGs, fonts, etc.
```

## 6. Build phases

### Phase 1 — minimum viable skill (single hard-coded flow)
- `SKILL.md` with workflow instructions: take a path to HTML + a YAML, drive Playwright via a Node template, run ffmpeg
- `references/playwright-template.md`: a Node script template the skill instructs Claude to copy + adapt
- `references/ffmpeg-pipeline.md`: the WebM→MP4 and MP4→GIF one-liners with explanations
- **Test**: hand-edit the template against `~/projects/claude-tabletop/examples/live-demo/index.html`, run it, get an MP4 + GIF that resembles the existing `runbook-demo.{mp4,gif}`
- **Estimated**: 2-3 hours

### Phase 2 — declarative flow (YAML input)
- `references/demo-script-format.md`: full YAML schema with examples
- `SKILL.md` updated to instruct Claude: parse user's YAML, emit a Playwright script that drives the flow, run it
- Skill should reject malformed YAML with clear error
- **Test**: 3 example YAMLs, each producing valid output. Use the `tabletop-runbook.yaml` as the dogfood example.
- **Estimated**: 3-4 hours

### Phase 3 — cursor + polish
- `references/click-pulse-cursor.md`: the full inject-via-`addInitScript` recipe
- Configurable styles via the `cursor` block in YAML
- **Test**: visual verification that cursor moves smoothly and pulse fires on clicks. Compare side-by-side against the claude-tabletop demo's cursor behavior.
- **Estimated**: 2 hours

### Phase 4 — GitHub-ready defaults + size caps
- ffmpeg pipeline detects output size, auto-downsizes (resolution then fps) if over `gif_max_mb`
- README-ready dimensions baked into defaults
- **Test**: deliberately script a 60s flow at 1280×720, verify GIF auto-trims to under 10 MB without manual intervention.
- **Estimated**: 2 hours

### Phase 5 — caption / title overlays (optional)
- YAML `captions:` block triggers ffmpeg drawtext filter
- Default styling: monospace, semi-transparent dark background, bottom-third position
- **Test**: 3-caption demo renders correctly with captions appearing/disappearing on time
- **Estimated**: 3 hours

### Phase 6 — documentation + examples
- `README.md` with banner, badges, hero demo (recorded via this skill — dogfood)
- `docs/INSTALL.md`
- `docs/EXAMPLES.md` walking through the 3 example YAMLs
- **Test**: a fresh user can install and produce their first demo in <5 minutes
- **Estimated**: 3 hours

**Total estimated effort: ~15-17 hours, doable in 2-3 focused sessions.**

## 7. Tech stack

All already installed on this machine — no new dependencies:

- **Playwright Node bindings** at `~/world-leaders-part4/node_modules/playwright/`
- **Bundled Chromium** at `~/.cache/ms-playwright/chromium-1217/`
- **ffmpeg 8.1.1** in PATH
- **ImageMagick 7.1.2** (for any preview-frame extraction)
- **Node.js 25.x**

## 8. Open questions / decisions for the build session

1. **YAML or TOML for the demo-script?** YAML is more common in this space; TOML is easier to parse without deps. **Recommend YAML.** Use `js-yaml` or just shell out to `yq`.
2. **Where does the user's YAML live?** Suggest convention: `<project>/.demos/<name>.yaml` or alongside the artifact. Skill should accept any absolute path passed as flag.
3. **Wait semantics granularity**: fixed ms only, or also `wait_for_selector: '...'`, `wait_for_timer: 'T+00:00:30'`? **Recommend**: ms-only in v0.1; selector-waits in v0.2.
4. **Caption styling defaults**: should they match the recorded artifact's design system, or be the skill's own neutral style? **Recommend**: skill's own neutral style; if facilitator wants matching, override via YAML.
5. **Mobile demos**: support viewport `375×667` in v0.1, or punt? **Recommend**: support in v0.1 — adds 5 minutes of work and unlocks mobile-app skill demos.
6. **Cursor sprite vs CSS shape**: SVG sprite for cursor is more polished but heavier; pure CSS is lighter and tweakable. **Recommend**: pure CSS in v0.1, SVG sprites as v0.2 if anyone asks.
7. **What runtime invokes the Node script?** `node` directly, or `npx`? Skill needs to find Playwright's location. **Recommend**: skill instructs Claude to `cd ~/world-leaders-part4 && node /tmp/<scratch>.mjs` since that's where Playwright is installed; OR use `node --experimental-vm-modules --input-type=module -e "$(cat script.mjs)"` from any directory.
8. **Should the skill also set up Playwright/Chromium if missing?** **Recommend**: NO — assume installed; document the install step in `INSTALL.md`. Adds robustness later in v0.2.

## 9. Distribution / publishing plan (post-build)

Same playbook as `claude-tabletop`:

1. Apache-2.0 license
2. GitHub repo at `cjcsecurity/readme-demo-recorder` (public)
3. Topics: `claude-code`, `claude-skill`, `playwright`, `ffmpeg`, `screencast`, `readme`, `documentation`, `demo-video`, `gif`, `mp4`, `automation`, `developer-tools`
4. README badges (license, demo, version)
5. Live demo: probably not applicable here (the skill produces an asset, doesn't have a runtime UI). Instead, the README's hero IS a demo recorded by the skill itself.
6. Social-preview banner via image gen + ImageMagick text overlay
7. v0.1.0 release tag with notes
8. SECURITY.md, CODEOWNERS, branch protection
9. Awesome-list submissions: ComposioHQ, BehiSecc, rohitg00 (skip hesreallyhim until 7-day repo-age clears)
10. LinkedIn announcement referencing claude-tabletop as the catalyst project — these are intentionally complementary skills

## 10. Inspirations / prior art (for design references)

- **Charm.sh `vhs`** (https://github.com/charmbracelet/vhs) — the aesthetic anchor. Terminal-recording-to-gif via a declarative `.tape` script. Nailing the same UX for browsers is the goal.
- **`livlign/claude-skills` `repo-visuals`** — bespoke README hero designer (different shape — designs vs. records).
- **`hyperframes` / `motion-frames`** in `~/tools/open-design/skills/` — generative motion content; this skill is the recorder counterpart.
- **The actual recording done for claude-tabletop** at `~/projects/claude-tabletop/docs/demos/runbook-demo.{mp4,gif}` — the proof of concept. The next session can `ls` that directory and watch the output the skill should reproduce automatically.
- **The recording session technique** is documented in this conversation's transcript at the point where the demo video for claude-tabletop was created. Key elements: `addInitScript` cursor injection, `page.mouse.move(x, y, {steps: 22})` for smooth motion, `page.mouse.down()/up()` with delay between for click-pulse trigger, `palettegen=stats_mode=diff` for clean GIFs.

## 11. What "v0.1 done" looks like

A user can:

1. `git clone https://github.com/cjcsecurity/readme-demo-recorder ~/.claude/skills/readme-demo-recorder`
2. Author a YAML at `<project>/.demos/<name>.yaml`
3. Invoke `/readme-demo-recorder --script <project>/.demos/<name>.yaml`
4. Wait ~30 seconds
5. Find polished MP4 + GIF in `<project>/docs/demos/` ready for README hero embedding

The skill records its own demo using its own format (the dogfood test). The repo's README hero IS that demo.

## 12. First commands the build session should run

To ramp up fast, the next Claude session should:

```bash
# 1. Read this plan and the claude-tabletop ref implementation
cat ~/projects/readme-demo-recorder/PLAN.md
ls ~/projects/claude-tabletop/docs/demos/
ffprobe -v error -show_format ~/projects/claude-tabletop/docs/demos/runbook-demo.mp4

# 2. Check the inspiration projects
ls ~/tools/open-design/skills/{hyperframes,motion-frames}/
# (read their SKILL.md for skill-author conventions)

# 3. Confirm tech stack is in place
node --version                                                    # 25.x
ffmpeg -version | head -1                                         # 8.1.x
ls ~/.cache/ms-playwright/chromium-1217/                          # Chromium present
ls ~/world-leaders-part4/node_modules/playwright/package.json     # Playwright Node bindings

# 4. Start with Phase 1 — the SKILL.md and Playwright template
```

---

**End of plan.** Ship the build by following phases 1-6 in order. Each phase is self-contained and testable. Resume from any phase boundary if context fills up.
