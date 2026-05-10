---
title: Playwright recording template
description: Annotated Node ESM template for Phase 1. Copy verbatim, edit only the FLOW section, run from a working directory that has node_modules linked from ~/world-leaders-part4.
---

# Playwright recording template (Phase 1)

This template:

1. Launches headless Chromium with `recordVideo` at 1280×720.
2. Injects a fake cursor + click-pulse renderer **after** `goto` (not via
   `addInitScript` — see SKILL.md "Cursor inject" section for why).
3. Exposes `moveTo(locator)` and `click(locator)` helpers that drive a
   smooth-glide cursor with a 22-step interpolated mouse move and an
   80 ms `mouseDown → mouseUp` window so the pulse animation captures
   on-screen.
4. Closes the context to flush the WebM, prints its absolute path on
   stdout for the next pipeline stage.

## How to run

```bash
# 1. Create a scratch dir with node_modules linked to where Playwright lives
WORK=$(mktemp -d)
ln -s /home/staycold66/world-leaders-part4/node_modules "$WORK/node_modules"

# 2. Save the template (with your edited FLOW) to that dir
cp <your-edited-script>.mjs "$WORK/demo.mjs"

# 3. Run from inside that dir so ESM resolves "playwright"
cd "$WORK" && node demo.mjs
# → prints "OUT_WEBM=/tmp/demo-record-XXXXXX/out.webm"
```

If the script errors with `ERR_MODULE_NOT_FOUND` for `playwright`, the
symlink is wrong or you ran from a different cwd. ESM module resolution
ignores `NODE_PATH`; the symlink is the supported workaround.

## The template

Copy this whole block. Edit ONLY the `// === FLOW ===` section.

```javascript
// readme-demo-recorder template — Phase 1 (hard-coded flow).
// Run from a working dir whose node_modules is symlinked to a Playwright install.
import { chromium } from 'playwright';
import { mkdtempSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ============================================================
// CONFIG — edit these for your demo
// ============================================================
const VIEWPORT = { width: 1280, height: 720 };
const TARGET = 'file:///absolute/path/to/index.html';   // or 'https://...'
const RECORD_DIR = mkdtempSync(path.join(tmpdir(), 'demo-record-'));
const OUT_WEBM = path.join(RECORD_DIR, 'out.webm');

// ============================================================
// CURSOR INJECT — DO NOT EDIT in Phase 1 (Phase 3 makes this configurable)
// ============================================================
const CURSOR_INJECT = `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const css = document.createElement('style');
  css.textContent = \`
    .__demo-cursor, .__demo-pulse {
      position: fixed; top: 0; left: 0;
      width: 22px; height: 22px;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      will-change: left, top, transform, opacity;
    }
    .__demo-cursor {
      background: rgba(255,255,255,0.95);
      box-shadow:
        0 0 0 2px rgba(15,18,26,0.85),
        0 4px 14px rgba(0,0,0,0.45);
      z-index: 2147483647;
      transition: transform 80ms ease-out;
    }
    .__demo-cursor.__demo-clicking { transform: translate(-50%, -50%) scale(0.78); }
    .__demo-pulse {
      border: 2px solid rgba(88,166,255,0.95);
      z-index: 2147483646;
      animation: __demo-pulse-anim 520ms ease-out forwards;
    }
    @keyframes __demo-pulse-anim {
      0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0.85; }
      100% { transform: translate(-50%, -50%) scale(2.6); opacity: 0; }
    }
  \`;
  document.documentElement.appendChild(css);

  const cursor = document.createElement('div');
  cursor.className = '__demo-cursor';
  cursor.style.left = '-50px';
  cursor.style.top = '-50px';
  document.documentElement.appendChild(cursor);

  let lastX = -50, lastY = -50;
  document.addEventListener('mousemove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    cursor.style.left = lastX + 'px';
    cursor.style.top = lastY + 'px';
  }, true);
  document.addEventListener('mousedown', () => {
    cursor.classList.add('__demo-clicking');
    const pulse = document.createElement('div');
    pulse.className = '__demo-pulse';
    pulse.style.left = lastX + 'px';
    pulse.style.top = lastY + 'px';
    document.documentElement.appendChild(pulse);
    setTimeout(() => pulse.remove(), 600);
  }, true);
  document.addEventListener('mouseup', () => {
    cursor.classList.remove('__demo-clicking');
  }, true);
})();
`;

// ============================================================
// LAUNCH + INJECT (no edits expected)
// ============================================================
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  recordVideo: { dir: RECORD_DIR, size: VIEWPORT },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
await page.goto(TARGET, { waitUntil: 'load' });
await page.evaluate(CURSOR_INJECT);   // post-goto inject — see SKILL.md note

// ============================================================
// HELPERS — call these from FLOW. Don't edit.
// ============================================================
const sel = (s) => page.locator(s).first();

async function moveTo(locator) {
  const box = await locator.boundingBox();
  if (!box) {
    console.warn('locator off-screen / hidden — skipping');
    return null;
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  await page.waitForTimeout(160);
  return { x, y };
}

async function click(locator) {
  const pos = await moveTo(locator);
  if (!pos) return;
  await page.mouse.down();
  await page.waitForTimeout(80);   // pulse trigger window
  await page.mouse.up();
  await page.waitForTimeout(40);
}

async function type(locator, text, perKeyMs = 28) {
  await moveTo(locator);
  await locator.click();
  await locator.type(text, { delay: perKeyMs });
}

async function scrollTo(selector) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, selector);
}

// ============================================================
// === FLOW ===   ← THIS IS THE ONLY SECTION YOU EDIT
// Define the user flow. Total runtime should target 15–30 s.
// ============================================================

// 1. Initial hold so the page settles + cursor materializes
await page.mouse.move(VIEWPORT.width * 0.6, VIEWPORT.height * 0.5, { steps: 10 });
await page.waitForTimeout(1500);

// 2. Click the primary action
await click(sel('#startBtn'));
await page.waitForTimeout(2200);

// 3. Scroll to a section, click something inside it
await scrollTo('#phase-1');
await page.waitForTimeout(1100);
await click(sel('#phase-1 .reveal-btn').first());
await page.waitForTimeout(2000);

// 4. Type into a field
// await type(sel('#decisionLogBody tr:last-child td:nth-child(2) textarea'),
//            'Declared SEV-2 — token theft confirmed', 28);
// await page.waitForTimeout(1500);

// 5. Trailing hold so the GIF doesn't end mid-action
await page.waitForTimeout(1500);

// === END FLOW ===

// ============================================================
// SHUTDOWN — don't edit
// ============================================================
await context.close();   // flushes the WebM
await browser.close();

const files = readdirSync(RECORD_DIR).filter((f) => f.endsWith('.webm'));
if (files.length === 0) {
  console.error('No .webm produced in ' + RECORD_DIR);
  process.exit(1);
}
const produced = path.join(RECORD_DIR, files[0]);
renameSync(produced, OUT_WEBM);
console.log('OUT_WEBM=' + OUT_WEBM);
```

## Editing the FLOW section

The skill's job is to translate the user's described flow into a sequence of
helper calls. Common patterns:

| User says                         | You write                                         |
|-----------------------------------|---------------------------------------------------|
| "Click the Start button"          | `await click(sel('#startBtn'));`                  |
| "Hover the menu without clicking" | `await moveTo(sel('.menu-toggle'));`              |
| "Scroll to the pricing section"   | `await scrollTo('#pricing'); await page.waitForTimeout(1100);` |
| "Type 'hello world' in the chat"  | `await type(sel('#chatInput'), 'hello world');`   |
| "Wait 2 seconds"                  | `await page.waitForTimeout(2000);`                |
| "Click the second reveal button"  | `await click(page.locator('.reveal-btn').nth(1));` |

Always pad each click/scroll with a `waitForTimeout` long enough for the
target's UI to settle. 2200 ms is a safe default for an async UI change;
1100 ms is fine for a pure CSS/JS animation.

## Running this template against the catalyst project

The Phase 1 verification ran this template against
`~/projects/claude-tabletop/examples/live-demo/index.html` with this flow:

```javascript
await page.mouse.move(VIEWPORT.width * 0.6, VIEWPORT.height * 0.5, { steps: 10 });
await page.waitForTimeout(900);
await click(sel('#timerStart'));
await page.waitForTimeout(2200);
await scrollTo('#phase-1');
await page.waitForTimeout(1400);
const phase1Reveals = page.locator('#phase-1 .reveal-btn');
await click(phase1Reveals.nth(0));
await page.waitForTimeout(2200);
await click(phase1Reveals.nth(1));
await page.waitForTimeout(2200);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await page.waitForTimeout(1100);
await click(sel('#revealAllBtn'));
await page.waitForTimeout(2400);
await click(sel('#hideAllBtn'));
await page.waitForTimeout(1500);
```

Total runtime: ~19 s. Output: `docs/demos/phase1-verification.{mp4,gif}`.
