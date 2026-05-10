---
title: Cursor injection recipe
description: How the fake cursor + click-pulse system works. Three styles (pulse, minimal, crosshair), pure CSS+JS, no external dependencies. Injected via page.evaluate after goto — addInitScript drops elements on file:// loads.
---

# Cursor injection recipe (Phase 3)

Playwright's real mouse cursor is **invisible** in `recordVideo` captures —
the headless browser doesn't paint a system cursor. To make a recording
useful, you have to render your own.

This file documents the technique:

1. The three cursor styles the driver supports.
2. Why the inject runs via `page.evaluate(...)` after `goto`, not
   `addInitScript` (a hard-won lesson from Phase 1).
3. The shared event-binding pattern.
4. CSS conventions (z-index, pointer-events, transform-origin).

## Why post-`goto` `evaluate`, not `addInitScript`

`addInitScript` is documented as "evaluated after the document was created
but before any of its scripts were run." For HTTP loads that's true. For
**`file://` loads in headless Chromium**, the IIFE runs but elements
appended to `document.documentElement` don't survive — the parser appears
to swap in a fresh `<html>` once it actually starts parsing the file.

What we observed in Phase 1 (logged in
`~/claude-memory/fixes/playwright-addinitscript-file-loads.md`):

```javascript
await context.addInitScript(CURSOR_INJECT);
const page = await context.newPage();
await page.goto('file:///path/to/index.html');

await page.evaluate(() => ({
  installed: !!window.__demoCursorInstalled,        // true
  cursorExists: !!document.querySelector('.__demo-cursor'),  // FALSE
}));
```

The `window`-scoped flag persists (because `window` survives the swap), but
the DOM tree doesn't. Net result: cursor invisible, click pulse never fires,
recording looks like a ghost is operating the page.

**Fix**: move the inject to `page.evaluate(...)` *after* `page.goto(...)`:

```javascript
const page = await context.newPage();
await page.goto(target, { waitUntil: 'load' });
await page.evaluate(CURSOR_INJECT);   // ← after goto
```

This is what `scripts/record.mjs` does. Don't change it without retesting
against the form-submission and shadcn-button examples (both `file://` targets).

## The three styles

| Style       | Look                                 | Click animation                                                | Best for                                |
|-------------|--------------------------------------|----------------------------------------------------------------|-----------------------------------------|
| `pulse`     | Filled circle, dark ring, drop shadow | Cursor scales to 0.78; expanding colored ring (520 ms)         | General-purpose, the catalyst look      |
| `minimal`   | Small filled dot, no ring             | Cursor scales to 0.5 (tiny springy easing). No ring.            | Typing-heavy, text-focused demos        |
| `crosshair` | Two perpendicular lines (a `+`)       | Cursor lines flash to `pulse_color`; small expanding `+` outline (380 ms) | Precision UI / dev-tool flavor   |

The driver dispatches in `buildCursorInject(cursor)`:

```javascript
function buildCursorInject(cursor) {
  if (cursor.style === 'minimal') return buildMinimalCursor(cursor);
  if (cursor.style === 'crosshair') return buildCrosshairCursor(cursor);
  return buildPulseCursor(cursor);
}
```

Each builder returns a self-contained IIFE string. The script runs once per
recording, sets `window.__demoCursorInstalled` to prevent double-install,
appends a `<style>` tag, creates a `<div class="__demo-cursor">`, and wires
three document-level listeners (`mousemove`, `mousedown`, `mouseup`).

### `pulse` — full construction

```javascript
function buildPulseCursor({ color, pulse_color, size }) {
  return `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const css = document.createElement('style');
  css.textContent = \`
    .__demo-cursor, .__demo-pulse {
      position: fixed; top: 0; left: 0;
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      will-change: left, top, transform, opacity;
    }
    .__demo-cursor {
      background: ${color};
      box-shadow:
        0 0 0 2px rgba(15,18,26,0.85),
        0 4px 14px rgba(0,0,0,0.45);
      z-index: 2147483647;
      transition: transform 80ms ease-out;
    }
    .__demo-cursor.__demo-clicking { transform: translate(-50%, -50%) scale(0.78); }
    .__demo-pulse {
      border: 2px solid ${pulse_color};
      z-index: 2147483646;
      animation: __demo-pulse-anim 520ms ease-out forwards;
    }
    @keyframes __demo-pulse-anim {
      0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0.85; }
      100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; }
    }
  \`;
  document.documentElement.appendChild(css);
  /* ... shared cursor wiring ... */
})();
`;
}
```

### `minimal` — quieter alternative

A solid color dot, no surrounding ring, no expanding pulse. The dot scales
**down** to 0.5 on click with a slight overshoot (`cubic-bezier(.2,.7,.3,1.4)`),
which reads as a tap without producing animation that competes with the
underlying UI. Default render size is 65 % of `cursor.size` so the dot stays
discreet even when the user passes a larger size for a different demo.

```css
.__demo-cursor {
  /* no ring, only a thin 1px dark hairline + shadow for contrast */
  box-shadow:
    0 0 0 1px rgba(15,18,26,0.55),
    0 1px 3px rgba(0,0,0,0.45);
  transition: transform 110ms cubic-bezier(.2,.7,.3,1.4);
}
.__demo-cursor.__demo-clicking { transform: translate(-50%, -50%) scale(0.5); }
```

### `crosshair` — precision feel

Two `::before`/`::after` pseudo-elements form the cross arms. On click,
both arms' background color flashes from `cursor.color` to `cursor.pulse_color`
and a small expanding `+` outline appears (380 ms).

Stroke width is proportional to size: `Math.max(1, Math.round(size * 0.09))`.
At the default `size: 22`, that's 2 px — readable, not chunky. At the
shadcn-button example's `size: 24`, also 2 px.

```css
.__demo-cursor::before { left: 0; right: 0; top: 50%;
  height: <stroke>px; transform: translateY(-50%); }
.__demo-cursor::after  { top: 0; bottom: 0; left: 50%;
  width: <stroke>px; transform: translateX(-50%); }
.__demo-cursor.__demo-clicking::before,
.__demo-cursor.__demo-clicking::after {
  background: <pulse_color>;
}
```

## Shared wiring pattern

Every style uses the same JS event binding (built by `cursorWiring(...)`):

```javascript
const cursorEl = document.createElement('div');
cursorEl.className = '__demo-cursor';
document.documentElement.appendChild(cursorEl);

let lastX = -50, lastY = -50;
document.addEventListener('mousemove', (e) => {
  lastX = e.clientX; lastY = e.clientY;
  cursorEl.style.left = lastX + 'px';
  cursorEl.style.top = lastY + 'px';
}, true);                                    // ← capture phase
document.addEventListener('mousedown', () => {
  cursorEl.classList.add('__demo-clicking');
  /* style-specific: spawn pulse element if applicable */
}, true);
document.addEventListener('mouseup', () => {
  cursorEl.classList.remove('__demo-clicking');
}, true);
```

Three things to know:

1. **All listeners are on `document` in capture phase**. Page-level scripts
   that `stopPropagation` would otherwise hide cursor events from us; the
   capture phase fires before any descendant handler can stop the bubble.
2. **`pointer-events: none`** on every cursor element. The fake cursor is
   purely visual; the real input events still hit the underlying UI.
3. **`z-index: 2147483647`** is the 32-bit signed integer max — guarantees
   the cursor sits above any modal, popover, or framework overlay you might
   otherwise have to fight.

## CSS conventions worth keeping

- `position: fixed; top: 0; left: 0;` + `transform: translate(-50%, -50%)`
  centers the element on its `(left, top)` coords. Don't compute "center"
  manually; let CSS do it.
- `will-change: left, top, transform, opacity` — promotes the element to
  its own layer so 12-fps GIF re-encodes don't tear on cursor motion.
- `transition` on the cursor itself (not the page); animations on a separate
  pulse element. Mixing the two would couple the click-down and pulse
  timings in ways that are hard to tune.

## Safety checks before shipping a new cursor style

If you add a fourth style, validate it against:

1. **Light + dark backgrounds.** The catalyst shadcn-button example has a
   light theme; the catalyst form-submission has a dark theme. Both are in
   the repo to keep this honest.
2. **Click visibility at 12 fps.** GIFs subsample to 12 fps, so a 200 ms
   pulse animation sees only ~3 frames. Anything under 250 ms total runtime
   risks looking like a single-frame artifact. The current animations are
   380–520 ms.
3. **No transform-origin surprises.** Combining `translate(-50%, -50%)` with
   `scale()` works because the transform-origin is the element's center.
   If you change the centering trick (e.g. to `margin: -11px 0 0 -11px`),
   `scale()` will pivot around the top-left and look wrong.
4. **The pulse element is removed eventually.** Each `mousedown` spawns a
   new pulse `<div>`; `setTimeout(remove, lifetime)` cleans it up. If you
   skip cleanup, a long demo accumulates dead elements and slows rendering.
