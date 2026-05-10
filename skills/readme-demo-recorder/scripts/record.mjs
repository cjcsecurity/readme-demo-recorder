// readme-demo-recorder driver — Phase 2 (YAML-driven flow).
// Usage: node record.mjs <path/to/script.yaml>
//   or:  ./record.sh <path/to/script.yaml>   (handles node_modules symlink)
//
// Input: a YAML demo-script (see references/demo-script-format.md).
// Output: MP4 and/or GIF at <output.dir>/<output.basename>.{mp4,gif}.

import { chromium } from 'playwright';
import yaml from 'js-yaml';
import {
  mkdtempSync, mkdirSync, readFileSync, readdirSync,
  renameSync, copyFileSync, existsSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ============================================================
// CLI
// ============================================================
const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0] === '-h' || argv[0] === '--help') {
  console.error('usage: record.mjs <path/to/script.yaml>');
  process.exit(2);
}
const SCRIPT_PATH = path.resolve(argv[0]);
if (!existsSync(SCRIPT_PATH)) {
  fail(`script not found: ${SCRIPT_PATH}`);
}

// ============================================================
// PARSE + VALIDATE
// ============================================================
const raw = readFileSync(SCRIPT_PATH, 'utf8');
let doc;
try {
  doc = yaml.load(raw);
} catch (err) {
  fail(`YAML parse error: ${err.message}`);
}
if (doc == null || typeof doc !== 'object') {
  fail('script must be a YAML mapping at the top level');
}

const config = validate(doc, SCRIPT_PATH);

// ============================================================
// PATHS
// ============================================================
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const OUT_DIR = path.isAbsolute(config.output.dir)
  ? config.output.dir
  : path.resolve(SCRIPT_DIR, config.output.dir);
mkdirSync(OUT_DIR, { recursive: true });

const RECORD_DIR = mkdtempSync(path.join(tmpdir(), 'demo-record-'));
const WEBM = path.join(RECORD_DIR, 'out.webm');
const MP4 = path.join(RECORD_DIR, `${config.output.basename}.mp4`);
const PALETTE = path.join(RECORD_DIR, 'palette.png');
const GIF = path.join(RECORD_DIR, `${config.output.basename}.gif`);

// ============================================================
// CURSOR INJECT
// ============================================================
const CURSOR_INJECT = buildCursorInject(config.cursor);

// ============================================================
// PLAYWRIGHT RUN
// ============================================================
log(`recording target: ${config.target}`);
log(`viewport: ${config.viewport.width}x${config.viewport.height}`);
log(`flow: ${config.flow.length} step(s)`);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: config.viewport,
  recordVideo: { dir: RECORD_DIR, size: config.viewport },
  deviceScaleFactor: 1,
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
await page.goto(config.target, { waitUntil: 'load' });
await page.evaluate(CURSOR_INJECT);

const helpers = makeHelpers(page, config.viewport);

try {
  for (let i = 0; i < config.flow.length; i++) {
    const step = config.flow[i];
    const label = describeStep(step);
    log(`  [${String(i + 1).padStart(2, '0')}/${config.flow.length}] ${label}`);
    await runStep(page, helpers, step);
  }
} catch (err) {
  // Still close the context so we don't leak resources, then re-throw.
  try { await context.close(); } catch {}
  try { await browser.close(); } catch {}
  fail(`flow failed at step: ${err.message}`);
}

await context.close();   // flushes the WebM
await browser.close();

// ============================================================
// MOVE WEBM
// ============================================================
const webms = readdirSync(RECORD_DIR).filter((f) => f.endsWith('.webm'));
if (webms.length === 0) fail(`no .webm produced in ${RECORD_DIR}`);
renameSync(path.join(RECORD_DIR, webms[0]), WEBM);
log(`webm: ${WEBM}`);

// ============================================================
// FFMPEG: MP4
// ============================================================
const wantMp4 = config.output.formats.includes('mp4');
const wantGif = config.output.formats.includes('gif');

if (wantMp4 || wantGif) {
  // We always need MP4 as an intermediate for the GIF. Captions burn in
  // here so they propagate automatically through the GIF cascade.
  log('encoding mp4...');
  const captionFilter = buildDrawtextChain(config.captions, config.captionStyle, RECORD_DIR);
  const vf = captionFilter ? `fps=24,${captionFilter}` : 'fps=24';
  if (config.captions.length > 0) {
    log(`burning ${config.captions.length} caption(s)`);
  }
  ffmpeg([
    '-y', '-i', WEBM,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '22', '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-an',
    MP4,
  ]);
}

let gifReport = null;
if (wantGif) {
  gifReport = encodeGifWithAutoFit({
    mp4: MP4,
    palettePath: PALETTE,
    gifPath: GIF,
    capMb: config.output.gif_max_mb,
  });
}

// ============================================================
// COPY TO OUTPUT
// ============================================================
const finals = [];
if (wantMp4) {
  const dst = path.join(OUT_DIR, `${config.output.basename}.mp4`);
  copyFileSync(MP4, dst);
  finals.push({ path: dst, type: 'mp4' });
}
if (wantGif) {
  const dst = path.join(OUT_DIR, `${config.output.basename}.gif`);
  copyFileSync(GIF, dst);
  finals.push({ path: dst, type: 'gif' });
}

// ============================================================
// REPORT
// ============================================================
console.log('');
for (const f of finals) {
  const sz = statSync(f.path).size;
  const mb = (sz / 1024 / 1024).toFixed(2);
  let suffix = '';
  if (f.type === 'gif' && gifReport) {
    suffix = `  (${gifReport.settings.label})`;
    if (gifReport.fitted === false) {
      suffix += `  ! exceeds ${config.output.gif_max_mb} MB cap — ladder exhausted`;
    }
  }
  console.log(`✓ ${f.type.padEnd(3)}  ${mb} MB  ${f.path}${suffix}`);
}

// ============================================================
// HELPERS
// ============================================================

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function log(msg) {
  process.stderr.write(`[record] ${msg}\n`);
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
  if (r.status !== 0) {
    const tail = (r.stderr || '').split('\n').slice(-20).join('\n');
    fail(`ffmpeg failed (exit ${r.status}):\n${tail}`);
  }
}

// Encode the GIF, then if it exceeds capMb, descend a quality ladder
// (smaller width and/or lower fps) until it fits or the ladder is exhausted.
// Returns { settings, sizeMb, fitted, attempts }.
function encodeGifWithAutoFit({ mp4, palettePath, gifPath, capMb }) {
  // Ordered from highest fidelity to lowest. Width drops first because it's
  // less perceptually painful than dropping fps; once we're below 720, we
  // start trading fps to avoid going below 540 (text becomes unreadable).
  const ladder = [
    { width: 960, fps: 12, label: '960px @ 12fps' },
    { width: 800, fps: 12, label: '800px @ 12fps' },
    { width: 720, fps: 12, label: '720px @ 12fps' },
    { width: 720, fps: 10, label: '720px @ 10fps' },
    { width: 640, fps: 10, label: '640px @ 10fps' },
    { width: 640, fps:  8, label: '640px @ 8fps'  },
    { width: 540, fps:  8, label: '540px @ 8fps'  },
  ];

  const attempts = [];
  let last = null;
  for (let i = 0; i < ladder.length; i++) {
    const step = ladder[i];
    log(`gif attempt ${i + 1}/${ladder.length}: ${step.label}`);
    encodeGifOnce({ mp4, palettePath, gifPath, width: step.width, fps: step.fps });
    const sz = statSync(gifPath).size;
    const mb = sz / 1024 / 1024;
    const attempt = { settings: step, sizeBytes: sz, sizeMb: mb };
    attempts.push(attempt);
    log(`  → ${mb.toFixed(2)} MB`);
    last = attempt;

    if (mb <= capMb) {
      if (i > 0) log(`gif fit at ${step.label} (cap: ${capMb} MB)`);
      return { ...attempt, fitted: true, attempts };
    }
  }

  console.warn(`! gif could not fit ${capMb} MB cap; shipping smallest attempt at ${last.settings.label} (${last.sizeMb.toFixed(2)} MB)`);
  return { ...last, fitted: false, attempts };
}

// Build a comma-separated chain of drawtext filters, one per caption.
// Each caption's text is written to a temp file and referenced via
// textfile= so we never have to escape user-supplied content.
function buildDrawtextChain(captions, style, recordDir) {
  if (!captions || captions.length === 0) return null;
  const parts = [];
  for (let i = 0; i < captions.length; i++) {
    const c = captions[i];
    const txtPath = path.join(recordDir, `caption_${i}.txt`);
    writeFileSync(txtPath, c.text, 'utf8');
    const startSec = (c.at_ms / 1000).toFixed(3);
    const endSec = ((c.at_ms + c.duration_ms) / 1000).toFixed(3);
    // ffmpeg filter args use ':' as separator, so quote each value.
    // textfile= reads bytes raw — no escaping needed for caption text itself.
    const drawtext = [
      `fontfile=${style.fontfile}`,
      `textfile=${txtPath}`,
      `fontsize=${style.fontsize}`,
      `fontcolor=${style.fontcolor}`,
      'box=1',
      `boxcolor=${style.boxcolor}`,
      `boxborderw=${style.boxborderw}`,
      'x=(w-text_w)/2',
      `y=h*${style.y_frac}`,
      `enable='between(t,${startSec},${endSec})'`,
    ].join(':');
    parts.push(`drawtext=${drawtext}`);
  }
  return parts.join(',');
}

function encodeGifOnce({ mp4, palettePath, gifPath, width, fps }) {
  ffmpeg([
    '-y', '-i', mp4,
    '-vf', `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff:max_colors=128`,
    palettePath,
  ]);
  ffmpeg([
    '-y', '-i', mp4, '-i', palettePath,
    '-lavfi',
    `fps=${fps},scale=${width}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=5`,
    gifPath,
  ]);
}

// All three styles share the same wiring — element creation, mousemove
// tracker, mousedown/up handlers — but different CSS and (for pulse +
// crosshair) a separate per-click pulse element. The shared JS is built
// once and templated with the style-specific CSS.
function buildCursorInject(cursor) {
  if (cursor.style === 'minimal') return buildMinimalCursor(cursor);
  if (cursor.style === 'crosshair') return buildCrosshairCursor(cursor);
  return buildPulseCursor(cursor);
}

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
  ${cursorWiring({ withPulse: true, pulseLifetimeMs: 600 })}
})();
`;
}

function buildMinimalCursor({ color, size }) {
  // Smaller default footprint reads as "minimal." Half-size feels right.
  const renderSize = Math.max(8, Math.round(size * 0.65));
  return `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const css = document.createElement('style');
  css.textContent = \`
    .__demo-cursor {
      position: fixed; top: 0; left: 0;
      width: ${renderSize}px; height: ${renderSize}px;
      border-radius: 50%;
      pointer-events: none;
      transform: translate(-50%, -50%);
      background: ${color};
      box-shadow:
        0 0 0 1px rgba(15,18,26,0.55),
        0 1px 3px rgba(0,0,0,0.45);
      z-index: 2147483647;
      transition: transform 110ms cubic-bezier(.2,.7,.3,1.4);
      will-change: left, top, transform;
    }
    .__demo-cursor.__demo-clicking { transform: translate(-50%, -50%) scale(0.5); }
  \`;
  document.documentElement.appendChild(css);
  ${cursorWiring({ withPulse: false })}
})();
`;
}

function buildCrosshairCursor({ color, pulse_color, size }) {
  const stroke = Math.max(1, Math.round(size * 0.09));   // proportional line weight
  return `
(() => {
  if (window.__demoCursorInstalled) return;
  window.__demoCursorInstalled = true;
  const css = document.createElement('style');
  css.textContent = \`
    .__demo-cursor {
      position: fixed; top: 0; left: 0;
      width: ${size}px; height: ${size}px;
      pointer-events: none;
      transform: translate(-50%, -50%);
      z-index: 2147483647;
      will-change: left, top;
    }
    .__demo-cursor::before, .__demo-cursor::after {
      content: '';
      position: absolute;
      background: ${color};
      box-shadow: 0 0 0 0.5px rgba(0,0,0,0.65);
      transition: background 90ms ease-out, box-shadow 90ms ease-out;
    }
    .__demo-cursor::before {
      left: 0; right: 0; top: 50%;
      height: ${stroke}px;
      transform: translateY(-50%);
    }
    .__demo-cursor::after {
      top: 0; bottom: 0; left: 50%;
      width: ${stroke}px;
      transform: translateX(-50%);
    }
    .__demo-cursor.__demo-clicking::before,
    .__demo-cursor.__demo-clicking::after {
      background: ${pulse_color};
      box-shadow: 0 0 0 0.5px rgba(0,0,0,0.85);
    }
    .__demo-pulse {
      position: fixed; top: 0; left: 0;
      width: ${size}px; height: ${size}px;
      border: ${stroke}px solid ${pulse_color};
      pointer-events: none;
      transform: translate(-50%, -50%);
      z-index: 2147483646;
      animation: __demo-crosshair-pulse 380ms ease-out forwards;
    }
    @keyframes __demo-crosshair-pulse {
      0%   { transform: translate(-50%, -50%) scale(0.7); opacity: 0.85; }
      100% { transform: translate(-50%, -50%) scale(2.0); opacity: 0; }
    }
  \`;
  document.documentElement.appendChild(css);
  ${cursorWiring({ withPulse: true, pulseLifetimeMs: 460 })}
})();
`;
}

function cursorWiring({ withPulse, pulseLifetimeMs = 0 }) {
  const pulseSpawn = withPulse ? `
    const pulse = document.createElement('div');
    pulse.className = '__demo-pulse';
    pulse.style.left = lastX + 'px';
    pulse.style.top = lastY + 'px';
    document.documentElement.appendChild(pulse);
    setTimeout(() => pulse.remove(), ${pulseLifetimeMs});` : '';

  return `
  const cursorEl = document.createElement('div');
  cursorEl.className = '__demo-cursor';
  cursorEl.style.left = '-50px';
  cursorEl.style.top = '-50px';
  document.documentElement.appendChild(cursorEl);

  let lastX = -50, lastY = -50;
  document.addEventListener('mousemove', (e) => {
    lastX = e.clientX; lastY = e.clientY;
    cursorEl.style.left = lastX + 'px';
    cursorEl.style.top = lastY + 'px';
  }, true);
  document.addEventListener('mousedown', () => {
    cursorEl.classList.add('__demo-clicking');${pulseSpawn}
  }, true);
  document.addEventListener('mouseup', () => {
    cursorEl.classList.remove('__demo-clicking');
  }, true);
  `;
}

function makeHelpers(page, viewport) {
  const sel = (s) => page.locator(s).first();

  async function moveTo(locator) {
    const box = await locator.boundingBox();
    if (!box) return null;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 22 });
    await page.waitForTimeout(160);
    return { x, y };
  }

  async function click(locator) {
    const pos = await moveTo(locator);
    if (!pos) return false;
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(40);
    return true;
  }

  async function type(locator, text, perKeyMs) {
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

  async function parkCursor(xRel, yRel) {
    const x = Math.round(viewport.width * xRel);
    const y = Math.round(viewport.height * yRel);
    await page.mouse.move(x, y, { steps: 10 });
  }

  return { sel, moveTo, click, type, scrollTo, parkCursor };
}

function resolveLocator(page, ref) {
  // ref can be:
  //   - string selector
  //   - { selector, nth }
  if (typeof ref === 'string') return page.locator(ref).first();
  if (ref && typeof ref === 'object' && typeof ref.selector === 'string') {
    const base = page.locator(ref.selector);
    if (Number.isInteger(ref.nth)) return base.nth(ref.nth);
    return base.first();
  }
  throw new Error('selector ref must be a string or { selector, nth }');
}

async function runStep(page, h, step) {
  if ('hold' in step) return page.waitForTimeout(step.hold);
  if ('wait' in step) return page.waitForTimeout(step.wait);
  if ('hover' in step) {
    const loc = resolveLocator(page, step.hover);
    const r = await h.moveTo(loc);
    if (!r) throw new Error(`hover target off-screen: ${describeStep(step)}`);
    return;
  }
  if ('click' in step) {
    const loc = resolveLocator(page, step.click);
    const ok = await h.click(loc);
    if (!ok) throw new Error(`click target off-screen: ${describeStep(step)}`);
    return;
  }
  if ('scroll_to' in step) {
    const sel = typeof step.scroll_to === 'string'
      ? step.scroll_to
      : step.scroll_to?.selector;
    if (!sel) throw new Error('scroll_to needs a selector');
    return h.scrollTo(sel);
  }
  if ('type' in step) {
    const t = step.type;
    if (!t || typeof t.selector !== 'string' || typeof t.text !== 'string') {
      throw new Error('type step needs { selector, text, [delay_ms] }');
    }
    return h.type(page.locator(t.selector).first(), t.text, t.delay_ms ?? 28);
  }
  if ('mouse_park' in step) {
    const p = step.mouse_park ?? {};
    return h.parkCursor(p.x ?? 0.5, p.y ?? 0.5);
  }
  throw new Error('unknown step: ' + JSON.stringify(step));
}

function describeStep(step) {
  if ('hold' in step) return `hold ${step.hold}ms`;
  if ('wait' in step) return `wait ${step.wait}ms`;
  if ('hover' in step) return `hover ${formatRef(step.hover)}`;
  if ('click' in step) return `click ${formatRef(step.click)}`;
  if ('scroll_to' in step) return `scroll_to ${formatRef(step.scroll_to)}`;
  if ('type' in step) return `type "${step.type?.text?.slice(0, 24)}…" → ${step.type?.selector}`;
  if ('mouse_park' in step) return `mouse_park (${step.mouse_park?.x ?? 0.5}, ${step.mouse_park?.y ?? 0.5})`;
  return JSON.stringify(step);
}

function formatRef(ref) {
  if (typeof ref === 'string') return ref;
  if (ref && ref.selector) return `${ref.selector}${Number.isInteger(ref.nth) ? `[nth=${ref.nth}]` : ''}`;
  return JSON.stringify(ref);
}

// ============================================================
// VALIDATION
// ============================================================

function validate(doc, scriptPath) {
  const errs = [];
  const warns = [];

  // target — accept absolute URI, OR a path resolved relative to the script
  let resolvedTarget = null;
  if (typeof doc.target !== 'string' || doc.target.length === 0) {
    errs.push('top-level "target" must be a non-empty string (file://…, http(s)://…, or a path)');
  } else if (/^(file|https?):\/\//.test(doc.target)) {
    resolvedTarget = doc.target;
  } else {
    // Treat as a filesystem path relative to the YAML script's directory
    const scriptDir = path.dirname(scriptPath);
    const abs = path.isAbsolute(doc.target)
      ? doc.target
      : path.resolve(scriptDir, doc.target);
    if (!existsSync(abs)) {
      errs.push(`"target" path not found: ${abs}`);
    } else {
      resolvedTarget = `file://${abs}`;
    }
  }

  // viewport
  const vp = doc.viewport ?? { width: 1280, height: 720 };
  if (!Number.isInteger(vp.width) || vp.width < 200 || vp.width > 3840) {
    errs.push(`viewport.width must be an integer in [200, 3840] — got: ${vp.width}`);
  }
  if (!Number.isInteger(vp.height) || vp.height < 200 || vp.height > 2160) {
    errs.push(`viewport.height must be an integer in [200, 2160] — got: ${vp.height}`);
  }

  // flow
  if (!Array.isArray(doc.flow) || doc.flow.length === 0) {
    errs.push('"flow" must be a non-empty array of steps');
  } else {
    for (let i = 0; i < doc.flow.length; i++) {
      const s = doc.flow[i];
      if (s == null || typeof s !== 'object' || Array.isArray(s)) {
        errs.push(`flow[${i}] must be a mapping`);
        continue;
      }
      const keys = Object.keys(s);
      if (keys.length !== 1) {
        errs.push(`flow[${i}] must have exactly one step key — got: ${keys.join(', ')}`);
        continue;
      }
      const k = keys[0];
      if (!['hold', 'wait', 'hover', 'click', 'scroll_to', 'type', 'mouse_park'].includes(k)) {
        errs.push(`flow[${i}] unknown step "${k}" — supported: hold, wait, hover, click, scroll_to, type, mouse_park`);
        continue;
      }
      if ((k === 'hold' || k === 'wait') && (!Number.isFinite(s[k]) || s[k] < 0 || s[k] > 60_000)) {
        errs.push(`flow[${i}].${k} must be a number of ms in [0, 60000] — got: ${s[k]}`);
      }
      if (k === 'type') {
        const t = s.type;
        if (!t || typeof t.selector !== 'string' || typeof t.text !== 'string') {
          errs.push(`flow[${i}].type must be { selector: <string>, text: <string>, delay_ms?: <int> }`);
        } else if (t.delay_ms != null && (!Number.isInteger(t.delay_ms) || t.delay_ms < 0 || t.delay_ms > 1000)) {
          errs.push(`flow[${i}].type.delay_ms must be an integer in [0, 1000] — got: ${t.delay_ms}`);
        }
      }
    }
  }

  // cursor
  const cursor = {
    style: doc.cursor?.style ?? 'pulse',
    color: doc.cursor?.color ?? 'rgba(255,255,255,0.95)',
    pulse_color: doc.cursor?.pulse_color ?? 'rgba(88,166,255,0.95)',
    size: doc.cursor?.size ?? 22,
  };
  if (!['pulse', 'minimal', 'crosshair'].includes(cursor.style)) {
    errs.push(`cursor.style must be one of pulse, minimal, crosshair — got: ${cursor.style}`);
  }
  if (typeof cursor.color !== 'string' || cursor.color.length === 0) {
    errs.push('cursor.color must be a non-empty CSS color string');
  }
  if (typeof cursor.pulse_color !== 'string' || cursor.pulse_color.length === 0) {
    errs.push('cursor.pulse_color must be a non-empty CSS color string');
  }
  if (!Number.isInteger(cursor.size) || cursor.size < 8 || cursor.size > 48) {
    errs.push(`cursor.size must be an integer in [8, 48] — got: ${cursor.size}`);
  }

  // output
  const output = {
    dir: doc.output?.dir ?? 'docs/demos/',
    basename: doc.output?.basename ?? 'demo',
    formats: doc.output?.formats ?? ['mp4', 'gif'],
    gif_max_mb: doc.output?.gif_max_mb ?? 10,
  };
  if (typeof output.dir !== 'string' || output.dir.length === 0) {
    errs.push('output.dir must be a non-empty string');
  }
  if (typeof output.basename !== 'string' || !/^[A-Za-z0-9._-]+$/.test(output.basename)) {
    errs.push(`output.basename must match [A-Za-z0-9._-]+ — got: ${output.basename}`);
  }
  if (!Array.isArray(output.formats) || output.formats.length === 0) {
    errs.push('output.formats must be a non-empty array');
  } else {
    const bad = output.formats.filter((f) => f !== 'mp4' && f !== 'gif');
    if (bad.length) errs.push(`output.formats only supports "mp4" and "gif" — got: ${bad.join(', ')}`);
  }
  if (!Number.isFinite(output.gif_max_mb) || output.gif_max_mb <= 0) {
    errs.push(`output.gif_max_mb must be a positive number — got: ${output.gif_max_mb}`);
  }

  // captions
  let captions = [];
  if (doc.captions != null) {
    if (!Array.isArray(doc.captions)) {
      errs.push('"captions" must be an array');
    } else {
      for (let i = 0; i < doc.captions.length; i++) {
        const c = doc.captions[i];
        if (c == null || typeof c !== 'object' || Array.isArray(c)) {
          errs.push(`captions[${i}] must be a mapping`);
          continue;
        }
        if (typeof c.text !== 'string' || c.text.length === 0) {
          errs.push(`captions[${i}].text must be a non-empty string`);
        }
        if (!Number.isFinite(c.at_ms) || c.at_ms < 0 || c.at_ms > 600_000) {
          errs.push(`captions[${i}].at_ms must be a number of ms in [0, 600000] — got: ${c.at_ms}`);
        }
        if (!Number.isFinite(c.duration_ms) || c.duration_ms <= 0 || c.duration_ms > 60_000) {
          errs.push(`captions[${i}].duration_ms must be a positive number ≤ 60000 — got: ${c.duration_ms}`);
        }
      }
      captions = [...doc.captions].sort((a, b) => a.at_ms - b.at_ms);
    }
  }

  // caption_style overrides
  const captionStyle = {
    fontfile: doc.caption_style?.fontfile ?? '/usr/share/fonts/TTF/DejaVuSansMono.ttf',
    fontsize: doc.caption_style?.fontsize ?? 26,
    fontcolor: doc.caption_style?.fontcolor ?? 'white',
    boxcolor: doc.caption_style?.boxcolor ?? 'black@0.6',
    boxborderw: doc.caption_style?.boxborderw ?? 14,
    y_frac: doc.caption_style?.y_frac ?? 0.78,
  };
  if (typeof captionStyle.fontfile !== 'string' || captionStyle.fontfile.length === 0) {
    errs.push('caption_style.fontfile must be a non-empty path string');
  } else if (captions.length > 0 && !existsSync(captionStyle.fontfile)) {
    errs.push(`caption_style.fontfile not found: ${captionStyle.fontfile}`);
  }
  if (!Number.isInteger(captionStyle.fontsize) || captionStyle.fontsize < 8 || captionStyle.fontsize > 120) {
    errs.push(`caption_style.fontsize must be an integer in [8, 120] — got: ${captionStyle.fontsize}`);
  }
  if (!Number.isFinite(captionStyle.y_frac) || captionStyle.y_frac < 0 || captionStyle.y_frac > 1) {
    errs.push(`caption_style.y_frac must be a number in [0, 1] — got: ${captionStyle.y_frac}`);
  }

  // duration_target_seconds is informational only in Phase 2
  if (doc.duration_target_seconds != null && (!Number.isFinite(doc.duration_target_seconds) || doc.duration_target_seconds < 1)) {
    warns.push(`duration_target_seconds is informational; got non-numeric value: ${doc.duration_target_seconds}`);
  }

  // unknown top-level keys
  const known = ['target', 'viewport', 'duration_target_seconds', 'flow', 'captions', 'caption_style', 'cursor', 'output'];
  for (const k of Object.keys(doc)) {
    if (!known.includes(k)) warns.push(`unknown top-level key "${k}" — ignored`);
  }

  if (errs.length) {
    console.error(`error: invalid demo-script at ${scriptPath}`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
  }
  for (const w of warns) console.error(`[record] warn: ${w}`);

  return {
    target: resolvedTarget,
    viewport: { width: vp.width ?? 1280, height: vp.height ?? 720 },
    flow: doc.flow,
    cursor,
    captions,
    captionStyle,
    output,
  };
}
