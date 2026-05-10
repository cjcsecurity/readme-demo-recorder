---
title: ffmpeg encoding pipeline
description: WebM → MP4 (libx264) and MP4 → GIF (two-pass palette) commands tuned for inline GitHub README rendering. These match the catalyst project's encoding profile.
---

# ffmpeg encoding pipeline (Phase 1)

Three stages, run in order. Inputs and outputs are all in the temp dir
returned by the Playwright script; copy the final MP4 + GIF to
`<project>/docs/demos/<basename>.{mp4,gif}` once they're verified.

## 1. WebM → MP4

```bash
ffmpeg -y -i "$WEBM" \
  -vf "fps=24" \
  -c:v libx264 -crf 22 -preset slow \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -an \
  "$MP4"
```

Flag-by-flag:

| Flag                 | Why                                                                                       |
|----------------------|-------------------------------------------------------------------------------------------|
| `-vf "fps=24"`       | Lock to 24 fps. Playwright's WebM lands at 25 fps; pinning matches the catalyst profile. |
| `-c:v libx264`       | H.264 — the only codec GitHub plays inline reliably.                                      |
| `-crf 22`            | Constant Rate Factor, perceptual quality knob. 22 = visually lossless for screencasts. Lower = bigger; higher = uglier. Don't go above 26 for text-heavy demos. |
| `-preset slow`       | Slower encoder = better compression at same quality. Recordings are short so the time hit is negligible. |
| `-pix_fmt yuv420p`   | The pixel format Safari + every embedded video player insists on. Without it, GitHub may refuse to render the MP4. |
| `-movflags +faststart` | Move the moov atom to the front of the file so the browser can start playback before the full file downloads. |
| `-an`                | Strip audio. Recordings have none, but an empty audio track confuses some players. |

## 2. MP4 → GIF (two-pass palette)

A single-pass GIF is small but the palette is awful. The two-pass approach
generates an optimal palette first, then applies it.

### Pass 1 — generate palette

```bash
ffmpeg -y -i "$MP4" \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=128" \
  "$PALETTE"
```

| Flag                                | Why                                                                       |
|-------------------------------------|---------------------------------------------------------------------------|
| `fps=12`                            | GIF at 12 fps reads as smooth without doubling the file size of 24 fps.   |
| `scale=960:-1:flags=lanczos`        | Downscale to 960 px wide, preserve aspect (`-1` = compute height). Lanczos = sharp. |
| `palettegen=stats_mode=diff`        | Weight palette toward changing pixels, not static UI chrome. Crucial for a UI demo where most pixels don't change. |
| `max_colors=128`                    | Half of GIF's 256-color cap. Keeps file size down without visible banding for typical screencasts. Bump to 256 if a demo has lots of gradients. |

### Pass 2 — apply palette

```bash
ffmpeg -y -i "$MP4" -i "$PALETTE" \
  -lavfi "fps=12,scale=960:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  "$GIF"
```

| Flag                          | Why                                                                                      |
|-------------------------------|------------------------------------------------------------------------------------------|
| `fps=12,scale=960:-1`         | Must match the palettegen pass exactly, or the palette won't fit the frames.             |
| `paletteuse=dither=bayer`     | Bayer dithering = ordered, no temporal noise. Cleaner than `floyd_steinberg` on UI.      |
| `bayer_scale=5`               | Larger scale = coarser pattern but less file growth. 5 is the sweet spot for screencasts. |

## 3. Verify

```bash
ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration -of default=nw=1 "$MP4"
ls -la "$MP4" "$GIF"
```

Expect:

- MP4: `width=1280`, `height=720`, `r_frame_rate=24/1`, duration in seconds.
- MP4 size: ~1.5–4 MB for a 20 s recording.
- GIF size: ~3–8 MB for a 20 s recording at 960 px / 12 fps.

If GIF is over 10 MB, see "Size cap fallback" below.

## 4. Size cap auto-fit (Phase 4)

GitHub renders inline assets up to ~10 MB. The driver enforces this via
the `output.gif_max_mb` field — if the first encode exceeds the cap,
`scripts/record.mjs` walks a quality ladder and re-encodes until the GIF
fits or the ladder is exhausted.

### The ladder

| Step | Width | fps | Approx. savings vs default | Notes                                |
|------|-------|-----|----------------------------|--------------------------------------|
| 1    | 960   | 12  | (default)                  | First attempt; what most flows use.  |
| 2    | 800   | 12  | ~30%                       | Width drop is barely perceptible.    |
| 3    | 720   | 12  | ~45%                       | Still text-readable.                 |
| 4    | 720   | 10  | ~55%                       | First fps drop; smooth enough.       |
| 5    | 640   | 10  | ~65%                       | Below this, expect text legibility issues. |
| 6    | 640   | 8   | ~72%                       | Choppy but watchable.                |
| 7    | 540   | 8   | ~78%                       | Last resort.                         |

Width drops first because area scaling is less perceptually painful than
fps drops — humans read fps changes as motion stutter, but minor scale
changes mostly look like the recording was taken at a different zoom.
Once the ladder is below 720 px, fps cuts pick up because going below
540 px makes most UI text unreadable.

### When it kicks in

Look for these lines on stderr:

```
[record] gif attempt 1/7: 960px @ 12fps
[record]   → 13.78 MB
[record] gif attempt 2/7: 800px @ 12fps
[record]   → 9.96 MB
[record] gif fit at 800px @ 12fps (cap: 10 MB)
```

The first line that says `gif fit` is the one that shipped. The settings
also appear in the final report:

```
✓ gif  9.96 MB  /path/to/output.gif  (800px @ 12fps)
```

### When the ladder is exhausted

If even the smallest setting (540 px @ 8 fps) doesn't fit, the driver
ships that smallest attempt and warns:

```
! gif could not fit 1 MB cap; shipping smallest attempt at 540px @ 8fps (1.46 MB)
✓ gif  1.46 MB  /path/to/output.gif  (540px @ 8fps)  ! exceeds 1 MB cap — ladder exhausted
```

Real fix: shorten the flow. A 60-second recording at 1280×720 will land
near 10 MB even at 540 px @ 8 fps. Cut waits, drop redundant clicks, or
split into multiple shorter demos.

### Manual override

There is no flag to skip the cascade. If you want a specific (width, fps)
pair, use the **MP4-only** workflow: set `output.formats: [mp4]` in your
YAML, then re-encode the produced MP4 to GIF by hand using the recipes
above. The MP4 is always encoded at full 1280×720 / 24 fps regardless of
the GIF cascade — the cascade only affects the GIF output.

## 5. Combined one-liner script

For convenience, here's the whole pipeline as one bash block. Set `WEBM` to
the path printed by the Playwright script, `BASENAME` to the demo name, and
`OUTDIR` to where the artifacts should land:

```bash
WEBM="/tmp/demo-record-XXXX/out.webm"
BASENAME="my-demo"
OUTDIR="/path/to/project/docs/demos"
mkdir -p "$OUTDIR"

WORK=$(dirname "$WEBM")
MP4="$WORK/$BASENAME.mp4"
PALETTE="$WORK/palette.png"
GIF="$WORK/$BASENAME.gif"

ffmpeg -y -i "$WEBM" -vf "fps=24" -c:v libx264 -crf 22 -preset slow \
  -pix_fmt yuv420p -movflags +faststart -an "$MP4"

ffmpeg -y -i "$MP4" \
  -vf "fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=128" \
  "$PALETTE"

ffmpeg -y -i "$MP4" -i "$PALETTE" \
  -lavfi "fps=12,scale=960:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5" \
  "$GIF"

cp "$MP4" "$OUTDIR/$BASENAME.mp4"
cp "$GIF" "$OUTDIR/$BASENAME.gif"

ffprobe -v error -show_entries stream=width,height,r_frame_rate,duration \
  -of default=nw=1 "$OUTDIR/$BASENAME.mp4"
ls -la "$OUTDIR/"
```
