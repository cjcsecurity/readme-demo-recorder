---
name: readme-demo-recorder
description: Record a polished, scripted-flow browser demo of an HTML page (or URL) for a README hero. Drives Playwright with a fake cursor + click pulse, then encodes WebM → MP4 + GIF tuned for GitHub asset rendering. Use when the user asks to "record a demo", "make a README gif", "capture a screencast of an HTML app", or ships a single-file HTML artifact and needs an inline demo for documentation.
triggers:
  - "record a demo"
  - "readme gif"
  - "readme demo"
  - "screencast"
  - "demo video"
  - "demo gif"
  - "record this html"
phase: 5
---

# readme-demo-recorder

Records a scripted user-flow on an HTML target and produces a polished MP4 + GIF
sized for inline GitHub README rendering. The visible mouse cursor and click
pulse are injected — Playwright's real cursor is invisible in headless captures.

> **Phase 5 scope.** YAML-driven flow + three cursor styles (`pulse`,
> `minimal`, `crosshair`) + automatic GIF size-cap enforcement + timed caption
> overlays via ffmpeg `drawtext` (burned into the MP4 and propagated to the
> GIF). Phase 1's hand-edited Node template remains the fallback for bespoke
> flows the YAML can't express. Phase 6 is docs + the dogfood README hero.

## When to use this skill

The user has an HTML target (single file, local server, or hosted URL) and
wants a README hero asset that **shows it being used**, not just sits there as
a screenshot. Examples that should trigger this skill:

- "Record a 20-second demo of `index.html` for the README"
- "Make me a gif of clicking through this app"
- "I just shipped this skill, generate the demo asset"

Don't use this skill for:

- **Single screenshots** — use a screenshot tool directly.
- **Authoring motion graphics from scratch** — that's `hyperframes` /
  `motion-frames` in `~/tools/open-design/skills/`.
- **Designing a bespoke README hero from scratch** — that's
  `livlign/claude-skills`'s `repo-visuals`.

## Workflow (Phase 2 — YAML driver)

1. **Ask the user what to record** unless they've already specified it. You
   need: (a) the HTML target (file path or URL), (b) a rough flow — what gets
   clicked, in what order, with what pauses. Keep it 15–30 seconds; longer
   flows blow past the 10 MB GIF cap (Phase 4 will auto-fit).
2. **Read [`references/demo-script-format.md`](references/demo-script-format.md)**
   for the full YAML schema. Step types: `hold`, `wait`, `hover`, `click`,
   `scroll_to`, `type`, `mouse_park`. Selector form: bare string or
   `{ selector, nth }`. See the file for caveats and common pitfalls
   (the `:nth-of-type` trap especially).
3. **Author the YAML** at a path the user owns — typically
   `<project>/.demos/<name>.yaml` or alongside the artifact. If the user is
   recording a single-file HTML target, a sibling YAML referencing
   `target: ./index.html` is portable. Use the three shipped examples
   under `examples/` as starting points:
   - `examples/tabletop-runbook.yaml` — multi-button flow with scrolls
   - `examples/form-submission/demo.yaml` — typing into form fields
   - `examples/shadcn-button/demo.yaml` — hover + click sequencing
4. **Invoke the driver:**
   ```bash
   /path/to/skills/readme-demo-recorder/scripts/record.sh <path/to/script.yaml>
   ```
   The wrapper handles the `node_modules` symlink trick (see "Tech stack" below).
   The driver validates the YAML, runs Playwright with the cursor inject,
   encodes WebM → MP4 → GIF, and copies finals to `<output.dir>/<output.basename>.{mp4,gif}`.
5. **Read the driver's stderr** for step-by-step progress and any warnings.
   The final two lines are the produced paths + sizes:
   ```
   ✓ mp4  1.70 MB  /path/to/docs/demos/tabletop-runbook.mp4
   ✓ gif  5.51 MB  /path/to/docs/demos/tabletop-runbook.gif
   ```
6. **If validation fails**, the driver exits 1 with a list of every
   violation. Fix and re-run.
7. **Captions (optional).** If the user wants timed text overlays
   ("Click Start", "Notice the timer"), add a `captions:` block to the
   YAML — each entry is `{ at_ms, text, duration_ms }`. The driver burns
   them into the MP4 via ffmpeg `drawtext`; they propagate to the GIF
   automatically because the GIF re-encodes from the captioned MP4.
   Defaults: monospace, white-on-semi-transparent-black, bottom third.
   Override styling via `caption_style:` if needed. See
   [`references/demo-script-format.md#captions-optional`](references/demo-script-format.md#captions-optional).
8. **GIF size-cap auto-fit.** The driver enforces `output.gif_max_mb`
   (default 10 MB) by walking a quality ladder: `960×12fps` → `800×12` →
   `720×12` → `720×10` → `640×10` → `640×8` → `540×8`. It stops at the
   first step that fits. If even the smallest step is over cap, the driver
   ships that smallest GIF and warns `! ladder exhausted` — real fix is to
   shorten the flow. See
   [`references/ffmpeg-pipeline.md`](references/ffmpeg-pipeline.md#4-size-cap-auto-fit-phase-4)
   for the full ladder.
9. **Show the user** the produced file paths and the size summary the
   driver already printed. No need to re-run ffprobe.

## Fallback: hand-edited Node template (Phase 1)

When the YAML schema can't express what the user needs (custom JS hooks,
exotic Playwright APIs, unusual recording shape), fall back to the Phase 1
template. Read [`references/playwright-template.md`](references/playwright-template.md),
copy the template into a working directory with `node_modules` symlinked,
edit the `// === FLOW ===` section, run it, then encode per
[`references/ffmpeg-pipeline.md`](references/ffmpeg-pipeline.md).
This path skips YAML parsing entirely; you have direct Playwright access.

## Defaults (don't override unless asked)

| Setting           | Default      | Why                                                |
|-------------------|--------------|----------------------------------------------------|
| Viewport          | 1280×720     | GitHub README rendering sweet spot                 |
| MP4 fps           | 24           | Smooth cursor; matches the catalyst demo's profile |
| MP4 codec         | libx264 crf 22 yuv420p +faststart | Compatible with every browser + small | 
| GIF fps           | 12           | Balance smoothness vs file size                    |
| GIF max width     | 960px        | First-pass cap before downsizing                   |
| GIF dither        | bayer scale 5 | Crisp without the dithering ant-march             |
| Cursor style      | white circle, dark ring, blue pulse | Visible on light + dark backgrounds |
| Click pulse       | 520 ms ease-out, scale 0.5 → 2.6 | Reads as a click without screaming   |
| Output dir        | `docs/demos/` | Matches catalyst project convention                |

## Cursor inject

Playwright's real mouse cursor is invisible in `recordVideo`. The driver
injects a `<div>` cursor bound to `mousemove`, plus (for `pulse` and
`crosshair`) a one-shot `<div>` pulse element on each `mousedown`. Inject
**after** `page.goto()`, not via `addInitScript` — `addInitScript` fires
before the document parser populates `<html>` for `file://` loads and the
appended cursor div doesn't survive. This is hard-won; don't move the
inject point.

Three styles are available via `cursor.style` in the YAML
(`pulse` | `minimal` | `crosshair`); see
[`references/click-pulse-cursor.md`](references/click-pulse-cursor.md) for
the full CSS+JS recipe of each, and
[`references/demo-script-format.md`](references/demo-script-format.md#cursor-optional)
for the YAML schema.

## Smooth motion magic numbers

These were tuned by hand against the catalyst project (`claude-tabletop`).
Don't change them in Phase 1 unless the user explicitly asks:

- `page.mouse.move(x, y, { steps: 22 })` — smooth glide; fewer steps look
  janky in the GIF, more cost real-time and stretch the recording.
- `page.mouse.down() → 80 ms wait → page.mouse.up()` — long enough for the
  pulse animation to be triggered visibly, short enough to feel like a click.
- 1500 ms initial hold after `goto` — gives the page a moment to settle and
  the cursor to fade in before action starts.
- 2200 ms wait after a click that triggers async UI changes (reveals,
  modals); 1100 ms after a quick UI change (theme toggle, scroll). Tune
  these to the page's animation timings.

## Tech stack (already installed)

- **Playwright Node** at `/home/staycold66/world-leaders-part4/node_modules/playwright/`
- **Bundled Chromium** at `~/.cache/ms-playwright/chromium-1217/`
- **ffmpeg** (8.x) in `PATH`
- **Node.js** 25.x

ESM module resolution starts at the script's directory and walks up. Since
`/tmp/<scratch>.mjs` doesn't have a parent with `node_modules`, the simplest
fix is to create a working directory next to a symlinked `node_modules`:

```bash
WORK=$(mktemp -d)
ln -s /home/staycold66/world-leaders-part4/node_modules "$WORK/node_modules"
cp <your-script>.mjs "$WORK/demo.mjs"
cd "$WORK" && node demo.mjs
```

`NODE_PATH` does **not** apply to ESM. Don't try it.

## Quality bar

Before reporting "done", verify:

1. **MP4 plays** — `ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration <file>` returns the expected geometry, fps, and duration.
2. **GIF is under 10 MB** — `ls -la` it.
3. **Cursor is visible during clicks** — extract a frame near a click moment with `ffmpeg -ss <t> -i out.mp4 -frames:v 1 frame.png` and inspect. The cursor is a 22 px white circle with a dark ring; the pulse is a blue ring expanding outward.
4. **No black flash frames** — visually scrub the GIF in `feh`, `xdg-open`, or
   the user's image viewer. If the start or end has a black flash,
   the recording window outpaced page paint — extend the initial hold or the
   last `wait`.

## Failure modes to recognize

- **Selector misses** — if a click silently does nothing, the locator
  matched a hidden / off-screen element. Wrap in `await
  expect(locator).toBeVisible()` before the click, or use `.scrollIntoViewIfNeeded()`.
- **Cursor missing in the recording** — you forgot to inject after `goto`,
  or the inject script errored. Add a `page.evaluate(() => !!document.querySelector('.__demo-cursor'))` assertion.
- **Recording is "fast-forwarded"** — Playwright timeouts shrink real waits.
  Keep waits explicit (`page.waitForTimeout(N)`); don't rely on `waitFor`
  with a short default.
- **GIF over 10 MB** — drop `fps=12` to `fps=10`, or scale to `720:-1`. Real
  fix in Phase 4.

## Dogfood (test artifacts)

The shipped examples were each run end-to-end through the driver during the
Phase 2 build session. Outputs at `docs/demos/`:

| Example                                 | MP4     | GIF     | Duration |
|-----------------------------------------|---------|---------|----------|
| `tabletop-runbook.yaml`                 | 1.7 MB  | 5.5 MB  | 18.2 s   |
| `form-submission/demo.yaml`             | 0.16 MB | 1.0 MB  | ~16 s    |
| `shadcn-button/demo.yaml`               | 0.08 MB | 0.21 MB | 14.5 s   |

The Phase 1 hand-edited reference (`docs/demos/phase1-verification.{mp4,gif}`)
is preserved for comparison — it produces near-identical output to
`tabletop-runbook` (proving the YAML driver and the hand-edited template
share the same encoding pipeline).

## Phase progression

- **Phase 1.** Hand-edit the template; run it. ✓
- **Phase 2.** YAML demo-script as input; driver runs it. ✓
- **Phase 3.** Three cursor styles (`pulse`, `minimal`, `crosshair`) with
  configurable color/size. ✓
- **Phase 4.** Auto-fit GIF to `gif_max_mb` via 7-step quality ladder
  (width-first, then fps). ✓
- **Phase 5 (this).** Caption overlays via ffmpeg `drawtext` — burned into
  MP4, propagated to GIF. ✓
- **Phase 6.** Docs, examples, dogfood README hero.
