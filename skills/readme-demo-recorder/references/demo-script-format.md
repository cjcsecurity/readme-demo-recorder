---
title: Demo-script YAML format
description: Schema reference for the YAML files that scripts/record.mjs consumes. Phase 2 supports target/viewport/flow/cursor/output. Captions and configurable cursor styles arrive in Phases 3 and 5.
---

# Demo-script YAML format (Phase 2)

A demo script is a YAML mapping with five top-level keys. The driver
(`scripts/record.mjs`) parses it, validates the schema, and produces a
recording.

```yaml
target: ./index.html        # required
viewport: { width: 1280, height: 720 }
duration_target_seconds: 20  # informational only
flow: [ ... ]               # required, non-empty
cursor: { ... }             # optional
output: { ... }             # optional
```

If the YAML is malformed the driver exits with code 1 and lists every
violation. Always validate by running the driver — there is no separate
linter.

---

## `target` (required)

The page to record. Any of:

| Form                                              | Behavior                                                                |
|---------------------------------------------------|-------------------------------------------------------------------------|
| `file:///absolute/path/to/index.html`             | Loaded as-is.                                                           |
| `https://example.com/page`                        | Loaded as-is. Network access required.                                  |
| `http://localhost:8080/`                          | Loaded as-is. Useful for local dev servers.                             |
| `./relative/path.html`                            | Resolved relative to the YAML file's directory, then prefixed `file://`. |
| `../other/index.html`                             | Same — relative to the YAML's directory.                                |
| `/absolute/path.html` (no scheme)                 | Resolved as a filesystem path, prefixed `file://`.                      |

**Use relative paths in example YAMLs** so the repo stays portable.

---

## `viewport` (optional, default `1280×720`)

```yaml
viewport:
  width: 1280
  height: 720
```

| Field    | Type    | Constraint              | Notes                                 |
|----------|---------|-------------------------|---------------------------------------|
| `width`  | integer | `[200, 3840]`           | 1280 = GitHub README sweet spot.      |
| `height` | integer | `[200, 2160]`           | 720 = 16:9 with the default width.    |

For mobile demos use `375×667` (iPhone SE), `390×844` (iPhone 14), or
`360×800` (typical Android).

---

## `duration_target_seconds` (optional, informational)

```yaml
duration_target_seconds: 20
```

Soft target you write down for yourself. The driver doesn't trim or pad to
match; it records whatever the flow takes. Helpful as a check: if the actual
duration is 5× this value, you forgot to add waits between actions.

---

## `flow` (required)

Non-empty array of steps. Each step is a mapping with **exactly one** of the
keys below. Steps run in order.

### Step types

#### `hold` — passive wait at the start

```yaml
- hold: 1500   # ms
```

Same semantics as `wait`. Convention: use `hold` for the initial settle
before any user action, `wait` for inter-action gaps. The driver doesn't
distinguish; it's purely for human readability.

#### `wait` — passive wait between actions

```yaml
- wait: 2200   # ms
```

Constraint: `[0, 60000]`. Tune to the page's animation timings — too short
and the recording cuts mid-animation, too long and the GIF balloons.

Common values:

| Situation                                | Suggested wait |
|------------------------------------------|----------------|
| After a click that triggers async JS     | 2000–2400 ms   |
| After a CSS-only animation               | 1100–1500 ms   |
| Between letters of a long phrase         | (use `type`'s `delay_ms`) |
| Trailing hold so the GIF doesn't end mid-action | 1500 ms |

#### `hover` — move cursor to a selector without clicking

```yaml
- hover: '#startBtn'
- hover: { selector: '.menu-item', nth: 2 }
```

The cursor glides to the selector's center over 22 interpolated steps. Use
this to demonstrate hover states, then follow with `wait` to let any hover
CSS settle, then `click` (or another `hover` somewhere else).

#### `click` — move cursor and click

```yaml
- click: '#submitBtn'
- click: { selector: '.reveal-btn', nth: 1 }
```

Triggers the cursor's pulse animation. Use the `{ selector, nth }` form when
you need to target a specific match in a list — `nth` is 0-based.

#### `scroll_to` — smooth-scroll a selector to viewport top

```yaml
- scroll_to: '#phase-1'
- scroll_to: { selector: 'main' }
```

Uses `Element.scrollIntoView({ behavior: 'smooth', block: 'start' })`. Pair
with a `wait` of ~1100 ms to let the scroll complete before the next action.

To scroll to the **top** of the page, `scroll_to: 'body'` works. To scroll
to a specific Y position, use `mouse_park` is **not** the answer — it parks
the cursor, not the viewport. (Phase 2 doesn't have a `scroll_y` step;
file an issue if you need it.)

#### `type` — focus an input and type into it

```yaml
- type:
    selector: '#email'
    text: 'ada@example.com'
    delay_ms: 28          # optional, default 28
```

| Field      | Type    | Constraint           | Notes                                                |
|------------|---------|----------------------|------------------------------------------------------|
| `selector` | string  | required             | Must resolve to one element. Use a unique ID if possible. |
| `text`     | string  | required             | Whatever to type. Newlines and special chars are fine. |
| `delay_ms` | integer | `[0, 1000]`, default 28 | Per-keystroke delay. 28 ms reads as natural typing. Drop to 18 for fast typing, raise to 60 for "demo-quality" deliberate typing. |

The driver focuses the field by clicking it (which also fires the cursor
pulse) before typing.

#### `mouse_park` — pre-position the cursor

```yaml
- mouse_park: { x: 0.5, y: 0.4 }
```

Both `x` and `y` are fractions of the viewport (`0` to `1`, default `0.5`).
Useful as the **first step** so the cursor is on-screen before the initial
hold rather than starting at `(0, 0)`.

---

## `cursor` (optional)

```yaml
cursor:
  style: pulse                              # pulse | minimal | crosshair
  color: 'rgba(255,255,255,0.95)'           # CSS color
  pulse_color: 'rgba(88,166,255,0.95)'      # CSS color
  size: 22                                  # px, [8, 48]
```

| Field         | Type    | Default                  | Notes                                                                                                  |
|---------------|---------|--------------------------|--------------------------------------------------------------------------------------------------------|
| `style`       | string  | `pulse`                  | One of `pulse`, `minimal`, `crosshair`. See style table below.                                         |
| `color`       | string  | `rgba(255,255,255,0.95)` | Any valid CSS color. Used as the cursor body / line color.                                             |
| `pulse_color` | string  | `rgba(88,166,255,0.95)`  | Any valid CSS color. Used by `pulse` and `crosshair` for click feedback. Ignored by `minimal`.         |
| `size`        | integer | `22`                     | Pixel size of the cursor footprint. `minimal` renders 65 % of this; `pulse` and `crosshair` render at this size. Range: `[8, 48]`. |

### Choosing a style

| Style       | When to use                                                         |
|-------------|---------------------------------------------------------------------|
| `pulse`     | Default. General-purpose, reads clearly on light + dark backgrounds. White cursor + colored pulse ring. |
| `minimal`   | Typing-heavy demos, dense text, anywhere the cursor would compete with content. A small solid dot, no ring, no expanding pulse. |
| `crosshair` | Precision UI / dev-tool demos. Two perpendicular lines (a `+`) with a color-flash + small expanding cross outline on click. |

For a dark theme, the default white cursor + blue pulse reads well. For a
light theme, try `cursor.color: 'rgba(24,24,27,0.95)'` and a saturated
brand-color pulse — see `examples/shadcn-button/demo.yaml` for a working
light-theme `crosshair` configuration.

For the visual implementation details (CSS, JS, why `page.evaluate` rather
than `addInitScript`), see
[`references/click-pulse-cursor.md`](click-pulse-cursor.md).

---

## `output` (optional)

```yaml
output:
  dir: '../docs/demos/'
  basename: 'my-demo'
  formats: [mp4, gif]
  gif_max_mb: 10
```

| Field         | Type     | Default          | Notes                                                                                |
|---------------|----------|------------------|--------------------------------------------------------------------------------------|
| `dir`         | string   | `docs/demos/`    | Output directory. Resolved relative to the YAML file unless absolute. Created if missing. |
| `basename`    | string   | `demo`           | Filename stem. Must match `[A-Za-z0-9._-]+`.                                          |
| `formats`     | array    | `[mp4, gif]`     | Subset of `['mp4', 'gif']`. The MP4 is always encoded as an intermediate; passing `[gif]` only suppresses the final MP4 copy. |
| `gif_max_mb`  | number   | `10`             | Driver auto-fits the GIF to this cap by descending a quality ladder (see [`references/ffmpeg-pipeline.md`](ffmpeg-pipeline.md#4-size-cap-auto-fit-phase-4)). If the smallest ladder step still exceeds the cap, the driver ships it and warns. |

---

## `captions` (optional)

Optional array of timed text overlays burned into the MP4 (and propagated
to the GIF, since the GIF re-encodes from the captioned MP4).

```yaml
captions:
  - at_ms: 1500
    text: 'Click Start to begin the exercise'
    duration_ms: 2500
  - at_ms: 5000
    text: 'Reveal injects one at a time'
    duration_ms: 4500
  - at_ms: 11000
    text: 'Or skip ahead with Reveal All'
    duration_ms: 3500
```

| Field         | Type    | Constraint        | Notes                                                          |
|---------------|---------|-------------------|----------------------------------------------------------------|
| `at_ms`       | number  | `[0, 600000]`     | When the caption appears, in ms from recording start.          |
| `text`        | string  | non-empty         | The caption content. Any character is allowed — the driver writes it to a temp file and references it via ffmpeg's `textfile=`, so colons, commas, quotes, em-dashes, and emoji all pass through unescaped. |
| `duration_ms` | number  | `(0, 60000]`      | How long the caption stays on screen.                          |

Captions are sorted by `at_ms` before encoding, so order in the YAML is
flexible. Overlapping windows are allowed but produce stacked, overlapping
text boxes — usually you want non-overlapping windows.

### Default styling

| Field        | Default                                   | Notes                                                                   |
|--------------|-------------------------------------------|-------------------------------------------------------------------------|
| Font         | DejaVu Sans Mono                          | `/usr/share/fonts/TTF/DejaVuSansMono.ttf` — ships with most Linux distros. |
| Font size    | 26 px                                     | Readable at 1280×720 and still readable when GIF cascade scales to 640. |
| Font color   | white                                     | Reads on dark + light backgrounds when paired with the dark box.        |
| Box          | semi-transparent black, `boxcolor=black@0.6`, 14 px padding | Anchors the text against busy backgrounds.            |
| Position     | horizontally centered, `y = h * 0.78`     | Bottom third — out of the way of most UI chrome.                        |

### Override the styling (optional)

Set `caption_style` at the top level:

```yaml
caption_style:
  fontfile: '/usr/share/fonts/TTF/JetBrainsMonoNerdFont-Regular.ttf'
  fontsize: 32
  fontcolor: 'rgba(56,189,248,1)'
  boxcolor: 'black@0.75'
  boxborderw: 18
  y_frac: 0.85       # 0 = top, 1 = bottom
```

Validation:

| Field         | Constraint                       |
|---------------|----------------------------------|
| `fontfile`    | Must exist on disk if any captions are configured. |
| `fontsize`    | Integer in `[8, 120]`.           |
| `fontcolor`   | Any ffmpeg-accepted color spec.  |
| `boxcolor`    | Any ffmpeg-accepted color spec; `name@alpha` for opacity. |
| `boxborderw`  | Integer (no upper bound enforced). |
| `y_frac`      | Number in `[0, 1]`. `0.5` = middle, `0.85` = lower third. |

### Why captions go on the MP4 first

ffmpeg's `drawtext` filter is applied during the MP4 encode. The resulting
MP4 is then the source for the GIF cascade, so captions appear in both
outputs without re-rendering. Side effect: caption fonts are scaled when
the GIF cascade downsizes, so a `fontsize: 26` MP4 caption becomes
proportionally smaller in a GIF rendered at 640 px wide. That's usually
what you want; if not, set `fontsize` higher and accept that the MP4 will
have slightly larger text than the GIF.

---

## Common pitfalls

### "click target off-screen"

The selector matched an element with no bounding box. Causes:

- Element exists in the DOM but has `display: none`.
- Element is below the fold and the previous `scroll_to` didn't reach it.
- Selector matched nothing — Playwright's `.first()` doesn't throw on no match
  but returns a locator with no `boundingBox`.

Fix: add a `scroll_to` before the click, or use a more specific selector.

### "click target off-screen" only on certain runs

The page has async data loading and the locator resolves before paint. Add
a `wait: 800` after navigation/load triggers.

### Recording is much shorter than `duration_target_seconds`

You forgot waits between actions. Each step in the flow runs as fast as
possible. Add explicit `wait` steps.

### GIF over 10 MB

The driver auto-fits via a 7-step quality ladder (width-first, then fps).
If your flow is so long that even the smallest step (540 px @ 8 fps) can't
fit the cap, you'll see `! ladder exhausted` in the report. Real fix:
shorten the flow. See
[`references/ffmpeg-pipeline.md`](ffmpeg-pipeline.md#4-size-cap-auto-fit-phase-4)
for the full ladder.

### Selector with `:nth-of-type(2)` doesn't work

CSS `:nth-of-type` is type-based, not class-based. `.foo:nth-of-type(2)`
matches "an element of class `foo` that is the 2nd child *of its element
type* among its siblings" — **not** "the 2nd `.foo`." Use the driver's
`{ selector, nth }` form instead, which is 0-based and matches by class:

```yaml
# Wrong (rarely does what you want):
- click: '.reveal-btn:nth-of-type(2)'

# Right:
- click: { selector: '.reveal-btn', nth: 1 }
```

---

## Full example

```yaml
target: ./index.html

viewport:
  width: 1280
  height: 720

duration_target_seconds: 18

flow:
  - mouse_park: { x: 0.5, y: 0.4 }
  - hold: 1200

  - type:
      selector: '#name'
      text: 'Ada Lovelace'
      delay_ms: 32
  - wait: 600

  - type:
      selector: '#email'
      text: 'ada@example.com'
      delay_ms: 28
  - wait: 1200

  - click: '#submitBtn'
  - wait: 2200

cursor:
  color: 'rgba(255,255,255,0.95)'
  pulse_color: 'rgba(56,189,248,0.95)'

output:
  dir: '../docs/demos/'
  basename: 'form-submission'
  formats: [mp4, gif]
```

This is the form-submission example shipped in `examples/form-submission/`.
