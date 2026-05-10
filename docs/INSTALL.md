# Install

`readme-demo-recorder` records browser demos with a fake-cursor inject and
encodes them to MP4 + GIF tuned for GitHub README rendering. It runs on
**Linux** out of the box (Playwright's bundled headless Chromium) and on
macOS with the same recipe; Windows is untested but the pipeline has no
Linux-specific calls.

## Prerequisites

| What            | Why                                                                      | Tested with     |
|-----------------|--------------------------------------------------------------------------|-----------------|
| **Node.js ≥ 18** | The driver is ESM and uses `node:` protocol imports.                     | Node 25.x       |
| **ffmpeg ≥ 6**  | WebM → MP4 (libx264) + MP4 → GIF (palettegen / paletteuse) + drawtext.   | ffmpeg 8.1.x    |
| **Playwright** + bundled Chromium | The recorder uses `chromium.launch({ headless: true })` and `recordVideo`. | Playwright 1.59, Chromium 1217 |
| **`js-yaml`**   | YAML demo-script parser. Installed alongside Playwright in this project. | js-yaml 4.x     |
| **A monospace TTF** | ffmpeg `drawtext` resolves the font by absolute path. Captions need this. | DejaVu Sans Mono ships with most Linux distros at `/usr/share/fonts/TTF/DejaVuSansMono.ttf`. |

Check what's already on your machine:

```bash
node --version             # ≥ v18
ffmpeg -version | head -1  # ≥ 6.x
ls /usr/share/fonts/TTF/DejaVuSansMono.ttf  # exists, or substitute another path
```

## Install paths

Pick the one that matches your environment.

### A. Drop-in beside an existing Playwright install

If you already have Playwright in another project, you can borrow its
`node_modules` via a symlink — the bundled wrapper handles this for you on
demand. Set `READMEDEMO_NODE_MODULES` to the path that contains
`playwright/` and `js-yaml/`:

```bash
git clone https://github.com/cjcsecurity/readme-demo-recorder.git
cd readme-demo-recorder
export READMEDEMO_NODE_MODULES=/path/to/your/project/node_modules
./skills/readme-demo-recorder/scripts/record.sh examples/shadcn-button/demo.yaml
```

The wrapper auto-creates the symlink the first time. If
`READMEDEMO_NODE_MODULES` is unset, it defaults to
`/home/staycold66/world-leaders-part4/node_modules` — the path that was
used during development. **Override that on any other machine.**

### B. Fresh standalone install

If you don't already have Playwright on the box:

```bash
git clone https://github.com/cjcsecurity/readme-demo-recorder.git
cd readme-demo-recorder

# Install Node deps next to the driver
cat > skills/readme-demo-recorder/scripts/package.json <<'EOF'
{
  "type": "module",
  "dependencies": {
    "playwright": "^1.59.0",
    "js-yaml": "^4.1.0"
  }
}
EOF
( cd skills/readme-demo-recorder/scripts && npm install )

# Install Chromium for Playwright
npx --yes -p playwright playwright install chromium

# Smoke test
./skills/readme-demo-recorder/scripts/record.sh examples/shadcn-button/demo.yaml
```

`record.sh` notices that `node_modules` already exists and skips the
symlink step.

### C. As a Claude Code skill

```bash
git clone https://github.com/cjcsecurity/readme-demo-recorder.git \
  ~/.claude/skills/readme-demo-recorder
```

Claude Code picks up `skills/readme-demo-recorder/SKILL.md` and routes
"record a demo of …" prompts through it. The skill instructs Claude to
author a YAML, then invoke `record.sh`. The skill itself doesn't install
Playwright — follow path A or B above to set up the runtime.

## Smoke test

```bash
./skills/readme-demo-recorder/scripts/record.sh examples/shadcn-button/demo.yaml
```

Expected output (bottom of stderr):

```
✓ mp4  0.08 MB  /…/docs/demos/shadcn-button.mp4
✓ gif  0.18 MB  /…/docs/demos/shadcn-button.gif  (960px @ 12fps)
```

End-to-end runtime: ~10 seconds for this example. If you instead see
errors, see "Troubleshooting" below.

## Troubleshooting

### `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'`

`record.sh` couldn't locate a Playwright install. Either:

- The `READMEDEMO_NODE_MODULES` env var points at a directory that has no
  `playwright/` subdirectory.
- The default fallback path (`/home/staycold66/world-leaders-part4/node_modules`) doesn't apply on this machine.
- `record.sh` was run from a different working directory than its own.

Set `READMEDEMO_NODE_MODULES` explicitly, or use install path B (fresh
standalone install).

### `caption_style.fontfile not found: /usr/share/fonts/TTF/DejaVuSansMono.ttf`

You're using captions but DejaVu Sans Mono isn't where the driver expects.
Either:

- Install it: `pacman -S ttf-dejavu` (Arch / EOS) · `apt install fonts-dejavu` (Debian / Ubuntu) · `brew install --cask font-dejavu` (macOS).
- Override per-script in your YAML:

  ```yaml
  caption_style:
    fontfile: '/path/to/your/Mono.ttf'
  ```

- Or override the default by editing `record.mjs`'s
  `validate()` function. (Do this if you have a house monospace font you
  want everyone in your org to use.)

### `error: invalid demo-script at <path>: …`

The driver lists every validation violation. Fix the YAML and re-run.
There is no separate linter — re-running is the linter.

### Recording starts but Chromium hangs partway through

The Playwright bundled Chromium might be sandboxed by your shell wrapper.
This is the same issue documented in `~/tools/open-design/skills/hyperframes/SKILL.md`
for headless renders inside Claude Code's macOS sandbox-exec wrapper. On
EndeavourOS / Linux this hasn't been observed; if you hit it, run
`record.sh` from a non-sandboxed shell directly.

### GIF is over the 10 MB cap and the cascade exhausted

Your flow is too long for the cap. Real fix is to shorten the flow — drop
redundant clicks, cut waits between actions, or split into two shorter
demos. See [`skills/readme-demo-recorder/references/ffmpeg-pipeline.md`](../skills/readme-demo-recorder/references/ffmpeg-pipeline.md#4-size-cap-auto-fit-phase-4)
for the full ladder.

### `ffmpeg: command not found`

Install ffmpeg: `pacman -S ffmpeg` · `apt install ffmpeg` · `brew install ffmpeg`.

### Cursor never appears in the recording

Most likely a regression — the inject moved from `page.evaluate` to
`addInitScript`. See [`skills/readme-demo-recorder/references/click-pulse-cursor.md`](../skills/readme-demo-recorder/references/click-pulse-cursor.md#why-post-goto-evaluate-not-addinitscript).
Don't refactor that line without re-testing all three example styles.

## Verifying the install matches the dogfood baseline

After install, run all three examples in sequence:

```bash
./skills/readme-demo-recorder/scripts/record.sh examples/tabletop-runbook.yaml
./skills/readme-demo-recorder/scripts/record.sh examples/form-submission/demo.yaml
./skills/readme-demo-recorder/scripts/record.sh examples/shadcn-button/demo.yaml
```

The committed `docs/demos/*.{mp4,gif}` were produced from the same YAMLs,
so a fresh run should produce visually equivalent output (modulo Playwright
timing jitter and minor encoder differences).
