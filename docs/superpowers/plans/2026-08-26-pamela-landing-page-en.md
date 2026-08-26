# Pamela Anggia Dewi Landing Page (English) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `landing-page/psikolog-pamela-anggia-dewi.html` (17 MB Elementor dump) as a single self-contained English page under 600 KB, with the Brainspotting credential raised to the top and the three client-corrected numbers.

**Architecture:** Author the page as separate `index.html` / `style.css` / `app.js` plus a folder of WebP assets, then inline all of it into one deliverable file with a build script. Assets are extracted once from the old HTML and converted to WebP through a headless-Chrome canvas (no `cwebp`/ImageMagick on this machine, no sudo to install one). A verification script drives headless Chrome against the built file and asserts the spec's acceptance criteria.

**Tech Stack:** Plain HTML/CSS/JS. Node ESM scripts. Playwright's bundled Chromium (already in `node_modules/playwright`, browser binary in `~/.cache/ms-playwright`).

**Spec:** `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md`

## Global Constraints

- Output is **one** file: `landing-page/pamela-anggia-dewi-en.html`. No sidecar assets, no external requests. The only absolute URLs allowed anywhere in it are the two CTA targets below.
- Output must be **under 600 KB**.
- `lang="en"`. British spelling: *counselling*, *honour*, *programme*. Not *counseling*.
- Book Appointment → `https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/`
- Contact Me → `https://wa.me/628115424069`
- Palette, verbatim: amber `#F2CD72`; hero `radial-gradient(at center right, #F2CD72 0%, #FFFFFF 100%)`; decorative orange `#F0904A`; **text** orange `#B45A12` (never `#F0904A` for text — it is 2.3:1 on white); text near-black.
- No entrance animations that start at `opacity: 0`. The old page did this and every large photo vanished when its JS did not run.
- All body copy comes verbatim from the spec's "Naskah" section. Do not paraphrase, do not invent service descriptions, do not add testimonials or pricing.
- `landing-page/psikolog-pamela-anggia-dewi.html` is read-only input. Never write to it.
- Every script runs from the repo root and needs `LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps` on this machine (see Task 1, Step 1).

---

## File Structure

| Path | Responsibility |
|---|---|
| `landing-page/src/pamela-en/extract.mjs` | Old HTML → `assets/*.webp`. Run once; rerun only if an asset changes. |
| `landing-page/src/pamela-en/assets/*.webp` | 13 generated images. Committed, so the page can be rebuilt without the ignored 17 MB source. |
| `landing-page/src/pamela-en/index.html` | Page markup with `{{style}}`, `{{script}}`, `{{asset:NAME}}` tokens. |
| `landing-page/src/pamela-en/style.css` | All styling. One file — the page is one page. |
| `landing-page/src/pamela-en/app.js` | FAQ accordion only. |
| `landing-page/src/pamela-en/build.mjs` | Template + CSS + JS + assets → the single output file. |
| `landing-page/src/pamela-en/verify.mjs` | Acceptance checks against the built file. |
| `landing-page/src/pamela-en/README.md` | How to build; the WSL Chromium dependency workaround. |
| `landing-page/pamela-anggia-dewi-en.html` | **Deliverable.** Generated; not committed. |

---

### Task 1: Asset pipeline

Extract the 13 images the new page needs from the old HTML and convert them to WebP.

**Files:**
- Modify: `.gitignore:75`
- Create: `landing-page/src/pamela-en/extract.mjs`
- Create: `landing-page/src/pamela-en/README.md`
- Generates: `landing-page/src/pamela-en/assets/*.webp`

**Interfaces:**
- Produces: 13 files in `assets/`, named exactly `hero-pamela.webp`, `icon-adults.webp`, `icon-children.webp`, `icon-couples.webp`, `icon-performance.webp`, `icon-medical.webp`, `logo-brainspotting.webp`, `logo-brainspotting-id.webp`, `logo-reattach.webp`, `logo-capacitar.webp`, `logo-ipk.webp`, `logo-himpsi.webp`, `logo-keuskupan.webp`. Task 4 references these names in `{{asset:...}}` tokens.

- [ ] **Step 1: Confirm headless Chromium runs**

```bash
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps \
  ~/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell --version
```

Expected: `Google Chrome for Testing 148.0.7778.96`

If it reports a missing `.so`, the deps folder is incomplete. Rebuild it without sudo:

```bash
cd "$(mktemp -d)" && apt-get download libnspr4 libnss3 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libpango-1.0-0 libcairo2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libatspi2.0-0 libxshmfence1 libexpat1 libxext6 libx11-6 libxcb1 libxau6 libxdmcp6 && for f in *.deb; do dpkg-deb -x "$f" r; done && mkdir -p ~/.local/share/chromium-deps && cp -r r/usr/lib/x86_64-linux-gnu/* r/lib/x86_64-linux-gnu/* ~/.local/share/chromium-deps/
```

- [ ] **Step 2: Un-ignore the hand-written landing-page sources**

`.gitignore` currently ignores the whole directory. Replace the `/landing-page/` line so the 347 MB of generated HTML stays out while the small hand-written files come in. Keep the existing comment block above it untouched.

```
/landing-page/*
!/landing-page/README.md
!/landing-page/MANIFEST.md
!/landing-page/tools/
!/landing-page/src/
/landing-page.zip
/landing-page.rar
```

A bare `/landing-page/` makes git skip the directory entirely, so negations inside it never fire — `/landing-page/*` is required for this to work.

- [ ] **Step 3: Verify the ignore rule does what it claims**

```bash
git check-ignore -v landing-page/psikolog-pamela-anggia-dewi.html landing-page/src/pamela-en/extract.mjs landing-page/pamela-anggia-dewi-en.html
```

Expected: the 17 MB page and the future deliverable are both matched by `/landing-page/*`; `landing-page/src/pamela-en/extract.mjs` prints nothing (not ignored).

- [ ] **Step 4: Write `extract.mjs`**

```js
// Old Elementor page -> assets/*.webp
// Selects each image by its unique `wp-image-NNNN` class, decodes the data: URI,
// and re-encodes through a canvas in headless Chrome. There is no cwebp or
// ImageMagick on this machine and no sudo to install one.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../psikolog-pamela-anggia-dewi.html');
const OUT = path.join(HERE, 'assets');

// name -> [wp-image id, max width px, webp quality]
const ASSETS = {
  'hero-pamela':          [42258, 900, 0.86],
  'icon-adults':          [38977, 220, 0.85],
  'icon-children':        [38979, 220, 0.85],
  'icon-couples':         [38975, 220, 0.85],
  'icon-performance':     [38981, 220, 0.85],
  'icon-medical':         [44178, 220, 0.85],
  'logo-brainspotting':   [42274, 400, 0.90],
  'logo-brainspotting-id':[42326, 400, 0.90],
  'logo-reattach':        [44186, 400, 0.90],
  'logo-capacitar':       [42321, 400, 0.90],
  'logo-ipk':             [42322, 400, 0.90],
  'logo-himpsi':          [42327, 400, 0.90],
  'logo-keuskupan':       [42328, 400, 0.90],
};

const html = fs.readFileSync(SRC, 'utf8');

function findDataUri(wpId) {
  const re = new RegExp(`<img[^>]*wp-image-${wpId}[^>]*>`, 'g');
  const tags = html.match(re);
  if (!tags) throw new Error(`wp-image-${wpId}: no <img> found`);
  if (tags.length > 1) throw new Error(`wp-image-${wpId}: ${tags.length} matches, expected 1`);
  const m = tags[0].match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
  if (!m) throw new Error(`wp-image-${wpId}: img has no data: URI src`);
  return m[1];
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

let total = 0;
for (const [name, [wpId, maxW, quality]] of Object.entries(ASSETS)) {
  const uri = findDataUri(wpId);
  const { dataUrl, w, h } = await page.evaluate(async ([uri, maxW, quality]) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return { dataUrl: c.toDataURL('image/webp', quality), w: c.width, h: c.height };
  }, [uri, maxW, quality]);

  if (!dataUrl.startsWith('data:image/webp')) {
    throw new Error(`${name}: canvas did not produce WebP`);
  }
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(path.join(OUT, `${name}.webp`), buf);
  total += buf.length;
  console.log(`${name}.webp  ${w}x${h}  ${(buf.length / 1024).toFixed(0)} KB`);
}
await browser.close();
console.log(`\n13 assets, ${(total / 1024).toFixed(0)} KB total`);
```

- [ ] **Step 5: Run it**

```bash
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/extract.mjs
```

Expected: 13 lines, `hero-pamela.webp 900x1273 ~77 KB`, total between 180 KB and 280 KB. Any `no <img> found` or `N matches, expected 1` means an id in `ASSETS` is wrong — fix the id, do not loosen the check.

- [ ] **Step 6: Eyeball every asset**

Build a contact sheet so the logos are checked visually, not just by byte count. Two backgrounds per logo, because `logo-brainspotting-id` is white and reads as blank on white — that is the defect this rebuild fixes, and it must be visible here.

```bash
cat > /tmp/sheet.mjs <<'EOF'
import { chromium } from 'playwright';
import fs from 'node:fs';
const dir = 'landing-page/src/pamela-en/assets';
const cells = fs.readdirSync(dir).filter(f => f.endsWith('.webp')).sort().map(f => {
  const b64 = fs.readFileSync(`${dir}/${f}`).toString('base64');
  const src = `data:image/webp;base64,${b64}`;
  return `<figure><div class=lt><img src="${src}"></div><div class=dk><img src="${src}"></div><figcaption>${f}</figcaption></figure>`;
}).join('');
fs.writeFileSync('/tmp/sheet.html', `<style>body{margin:0;background:#bbb;font:11px monospace;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:8px}figure{margin:0}.lt{background:#fff;padding:8px}.dk{background:#222;padding:8px}img{max-width:100%;max-height:140px;object-fit:contain;display:block;margin:auto}figcaption{text-align:center;padding-top:4px;word-break:break-all}</style>${cells}`);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
await p.goto('file:///tmp/sheet.html');
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/asset-sheet.png', fullPage: true });
await b.close();
EOF
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node /tmp/sheet.mjs
```

Then open `/tmp/asset-sheet.png` and confirm: the hero is Pamela cut out with a transparent background; five distinct orange icons; seven readable logos; `logo-brainspotting-id` is legible on the dark half and invisible on the light half.

- [ ] **Step 7: Write `README.md`**

```markdown
# pamela-anggia-dewi-en

Source for `landing-page/pamela-anggia-dewi-en.html` — an English rebuild of the
archived Elementor page `psikolog-pamela-anggia-dewi.html`.

Design: `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md`

## Build

    node build.mjs      # writes ../../pamela-anggia-dewi-en.html
    node verify.mjs     # acceptance checks against the built file

## Assets

`assets/*.webp` is generated by `extract.mjs`, which reads the archived 17 MB
page. That page is gitignored, so the WebP files are committed — otherwise a
fresh clone could not rebuild. Rerun `extract.mjs` only to change an asset.

Conversion goes through a canvas in headless Chrome: this machine has no cwebp
and no ImageMagick, and no sudo to install either.

## Headless Chrome on WSL

Playwright's Chromium ships without its shared-library dependencies and this box
has no passwordless sudo. The libraries live in `~/.local/share/chromium-deps`;
every script needs:

    LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node build.mjs

To rebuild that folder, see Task 1 Step 1 of
`docs/superpowers/plans/2026-08-26-pamela-landing-page-en.md`.
```

- [ ] **Step 8: Commit**

```bash
git add .gitignore landing-page/src/pamela-en/extract.mjs landing-page/src/pamela-en/README.md landing-page/src/pamela-en/assets
git commit -m "feat(landing-page): extract Pamela page assets as WebP

Selects 13 images out of the archived Elementor page by their unique
wp-image class and re-encodes them through a canvas in headless Chrome,
because this box has neither cwebp nor ImageMagick nor sudo. 4.2 MB of
PNG becomes ~225 KB of WebP.

Un-ignores the hand-written files under landing-page/ so the source and
the generated assets are tracked; the 347 MB of archived HTML stays out.
The assets are committed because their input is not."
```

---

### Task 2: Build script

Inline the template, CSS, JS, and assets into the single deliverable.

**Files:**
- Create: `landing-page/src/pamela-en/build.mjs`
- Create: `landing-page/src/pamela-en/index.html` (skeleton only — real sections land in Tasks 4-6)
- Create: `landing-page/src/pamela-en/style.css` (tokens only)
- Create: `landing-page/src/pamela-en/app.js` (empty stub)

**Interfaces:**
- Consumes: `assets/<name>.webp` from Task 1.
- Produces: `landing-page/pamela-anggia-dewi-en.html`. Task 3's `verify.mjs` reads this path.
- Template contract: `build.mjs` replaces `{{style}}`, `{{script}}`, and every `{{asset:NAME}}` with a `data:image/webp;base64,…` URI. An unknown asset name is a hard error; an unused asset is a hard error.

- [ ] **Step 1: Write `build.mjs`**

```js
// index.html + style.css + app.js + assets/*.webp -> one self-contained file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../../pamela-anggia-dewi-en.html');

const template = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(HERE, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(HERE, 'app.js'), 'utf8');

const assetDir = path.join(HERE, 'assets');
const assets = new Map(
  fs.readdirSync(assetDir)
    .filter(f => f.endsWith('.webp'))
    .map(f => [
      f.replace(/\.webp$/, ''),
      `data:image/webp;base64,${fs.readFileSync(path.join(assetDir, f)).toString('base64')}`,
    ]),
);

const used = new Set();
let html = template
  .replace('{{style}}', () => css)
  .replace('{{script}}', () => js)
  .replace(/\{\{asset:([a-z0-9-]+)\}\}/g, (_, name) => {
    const uri = assets.get(name);
    if (!uri) throw new Error(`unknown asset "${name}" — assets/ has: ${[...assets.keys()].join(', ')}`);
    used.add(name);
    return uri;
  });

const unused = [...assets.keys()].filter(n => !used.has(n));
if (unused.length) throw new Error(`assets never referenced: ${unused.join(', ')}`);

for (const token of html.match(/\{\{[^}]+\}\}/g) ?? []) {
  throw new Error(`unreplaced token ${token}`);
}

fs.writeFileSync(OUT, html);
const kb = fs.statSync(OUT).size / 1024;
console.log(`${path.relative(process.cwd(), OUT)}  ${kb.toFixed(0)} KB`);
if (kb > 600) throw new Error(`over the 600 KB budget by ${(kb - 600).toFixed(0)} KB`);
```

`.replace(a, () => b)` with a **function** is deliberate: with a string replacement, a `$&` inside the CSS or JS would be read as "the matched text" and silently corrupt the output. `landing-page/tools/inline.mjs` documents the same trap.

- [ ] **Step 2: Write the skeleton `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pamela Anggia Dewi, M.Psi., Psikolog — Certified International Brainspotting Consultant &amp; Therapist</title>
<meta name="description" content="Clinical psychologist and internationally certified psychotherapist. Certified International Brainspotting Consultant &amp; Therapist, working with Brainspotting, ReAttach and Capacitar.">
<style>{{style}}</style>
</head>
<body>
<main>
</main>
<script>{{script}}</script>
</body>
</html>
```

- [ ] **Step 3: Write `style.css` with the palette tokens**

```css
:root {
  --amber: #F2CD72;
  --orange: #F0904A;      /* decorative only — 2.3:1 on white */
  --orange-ink: #B45A12;  /* text — 4.8:1 on white */
  --ink: #17181A;
  --ink-soft: #4A4E56;
  --line: #E6E3DC;
  --surface: #FAF8F4;
  --hero: radial-gradient(at center right, #F2CD72 0%, #FFFFFF 100%);
  --space: 8px;
}
* { box-sizing: border-box; }
body { margin: 0; color: var(--ink); background: #fff;
  font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.6; -webkit-font-smoothing: antialiased; }
img { max-width: 100%; height: auto; display: block; }
```

The font is referenced but not embedded — the fallback stack carries it. Embedding Plus Jakarta Sans would add ~100 KB for a face most readers will not notice, and a `<link>` to Google Fonts would break the "no external requests" constraint.

- [ ] **Step 4: Write the `app.js` stub**

```js
// FAQ accordion — implemented in Task 6.
```

- [ ] **Step 5: Run the build; expect it to fail loudly**

```bash
node landing-page/src/pamela-en/build.mjs
```

Expected: `Error: assets never referenced: hero-pamela, icon-adults, …` — the skeleton uses none of them yet. This proves the unused-asset guard works.

- [ ] **Step 6: Temporarily reference one asset and confirm a clean build**

Add `<img src="{{asset:hero-pamela}}" alt="">` inside `<main>`, rerun, and confirm it now fails with the *other* twelve listed. Then comment the guard check? **No** — instead, keep the guard and accept that the build only goes green once Task 6 lands. Revert the temporary `<img>`.

To keep Tasks 4-6 testable before every asset is wired, run the build with the guard relaxed:

```bash
SKIP_UNUSED_CHECK=1 node landing-page/src/pamela-en/build.mjs
```

Add that escape hatch to `build.mjs` now, right above the `unused.length` throw:

```js
if (unused.length && !process.env.SKIP_UNUSED_CHECK) throw new Error(`assets never referenced: ${unused.join(', ')}`);
```

- [ ] **Step 7: Confirm the escape hatch builds**

```bash
SKIP_UNUSED_CHECK=1 node landing-page/src/pamela-en/build.mjs
```

Expected: `landing-page/pamela-anggia-dewi-en.html  1 KB`

- [ ] **Step 8: Commit**

```bash
git add landing-page/src/pamela-en/build.mjs landing-page/src/pamela-en/index.html landing-page/src/pamela-en/style.css landing-page/src/pamela-en/app.js
git commit -m "feat(landing-page): build script for the single-file English page

Inlines template, CSS, JS and WebP assets into one file and enforces the
600 KB budget. Replacements use function callbacks so a \$& inside minified
CSS or JS cannot inject itself into the output."
```

---

### Task 3: Verification harness

Write the acceptance checks before the page exists, so they fail for the right reason.

**Files:**
- Create: `landing-page/src/pamela-en/verify.mjs`

**Interfaces:**
- Consumes: `landing-page/pamela-anggia-dewi-en.html` from Task 2.
- Requires from Tasks 4-6, by exact id: `#credential-badge`, `#stat-years`, `#stat-clients`, `#stat-hours`, `#cta-book` (one or more), `.cta-contact` (one or more), `#faq` containing exactly five `details` elements.

- [ ] **Step 1: Write `verify.mjs`**

```js
// Acceptance checks for the built page. Exits non-zero on any failure.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '../../pamela-anggia-dewi-en.html');
const BOOK = 'https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/';
const WA = 'https://wa.me/628115424069';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const html = fs.readFileSync(FILE, 'utf8');
const sizeKb = fs.statSync(FILE).size / 1024;
check('under 600 KB', sizeKb < 600, `${sizeKb.toFixed(0)} KB`);

// Self-contained: the only absolute URLs may be the two CTA targets.
const urls = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
const stray = [...new Set(urls)].filter(u => u !== BOOK && u !== WA);
check('no external references', stray.length === 0, stray.join(' '));
check('no external stylesheet', !/<link[^>]+rel=["']?stylesheet/i.test(html));
check('lang is en', /<html[^>]+lang="en"/.test(html));
check('British spelling', !/\bcounseling\b/i.test(html) && !/\bhonor\b/i.test(html));

const browser = await chromium.launch();

// --- with JavaScript ---
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto('file://' + FILE, { waitUntil: 'load' });
await page.waitForTimeout(500);
check('no console errors', errors.length === 0, errors.join(' | '));

const imgs = await page.evaluate(() =>
  [...document.images].map(i => ({
    alt: i.alt,
    loaded: i.naturalWidth > 0,
    visible: i.getBoundingClientRect().width > 0 && getComputedStyle(i).opacity >= 0.99,
  })));
check('images present', imgs.length === 13, `${imgs.length} images`);
check('all images decode', imgs.every(i => i.loaded), imgs.filter(i => !i.loaded).map(i => i.alt).join(', '));
check('all images visible', imgs.every(i => i.visible), imgs.filter(i => !i.visible).map(i => i.alt).join(', '));

const stats = await page.evaluate(() => ({
  years: document.querySelector('#stat-years')?.textContent.trim(),
  clients: document.querySelector('#stat-clients')?.textContent.trim(),
  hours: document.querySelector('#stat-hours')?.textContent.trim(),
}));
check('16+ years', stats.years?.includes('16+'), stats.years);
check('1,500+ clients', stats.clients?.includes('1,500+'), stats.clients);
check('8,000+ hours', stats.hours?.includes('8,000+'), stats.hours);

const links = await page.evaluate(() => ({
  book: [...document.querySelectorAll('#cta-book, .cta-book')].map(a => a.href),
  contact: [...document.querySelectorAll('.cta-contact')].map(a => a.href),
}));
check('book links correct', links.book.length > 0 && links.book.every(h => h === BOOK), links.book.join(' '));
check('contact links correct', links.contact.length > 0 && links.contact.every(h => h === WA), links.contact.join(' '));

// FAQ accordion actually toggles.
const faq = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#faq details')];
  if (items.length !== 5) return { count: items.length };
  const first = items[0];
  const before = first.open;
  first.querySelector('summary').click();
  return { count: items.length, toggled: first.open !== before };
});
check('five FAQ items', faq.count === 5, `${faq.count}`);
check('FAQ toggles', faq.toggled === true);

// Credential badge above the fold, desktop and phone.
for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const el = document.querySelector('#credential-badge');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, vh: innerHeight };
  });
  check(`credential badge above the fold (${label})`, r != null && r.bottom > 0 && r.bottom <= r.vh,
    r ? `bottom ${r.bottom.toFixed(0)} of ${r.vh}` : 'element missing');
}

// No horizontal overflow at any width.
for (const w of [390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(150);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
}
await ctx.close();

// --- without JavaScript ---
const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
const p2 = await noJs.newPage();
await p2.goto('file://' + FILE, { waitUntil: 'load' });
const readable = await p2.evaluate(() => {
  const answers = [...document.querySelectorAll('#faq details p')];
  const visibleImgs = [...document.images].filter(i => getComputedStyle(i).opacity >= 0.99).length;
  return { answers: answers.length, textLen: document.body.innerText.length, visibleImgs };
});
check('FAQ answers in the DOM without JS', readable.answers === 5, `${readable.answers}`);
check('page readable without JS', readable.textLen > 3000, `${readable.textLen} chars`);
check('images not hidden without JS', readable.visibleImgs === 13, `${readable.visibleImgs} visible`);
await noJs.close();
await browser.close();

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
```

The no-JS pass is not ceremony. The old page set `opacity: 0` on every large photo and restored it from JavaScript; when that JavaScript did not run, the portrait and every logo silently disappeared. `images not hidden without JS` is the regression test for exactly that.

- [ ] **Step 2: Run it against the skeleton**

```bash
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify.mjs
```

Expected: exit 1. `under 600 KB` and `lang is en` pass; `images present`, the three stats, both CTA groups, the FAQ checks, and the credential badge all FAIL. That is the correct starting state.

- [ ] **Step 3: Commit**

```bash
git add landing-page/src/pamela-en/verify.mjs
git commit -m "test(landing-page): acceptance checks for the English page

Asserts the spec's criteria against the built file: size budget, no
external references, the three corrected numbers, both CTA targets, the
credential badge above the fold on desktop and phone, no horizontal
overflow at 390/768/1440, and a second pass with JavaScript disabled.

That last pass is the regression test for how the old page failed: it
set opacity:0 on every large photo and restored it from JS, so the
portrait and all seven logos vanished whenever the JS did not run."
```

---

### Task 4: Hero and credential strip

Sections 1-2. This is where the client's central request lands.

**Files:**
- Modify: `landing-page/src/pamela-en/index.html`
- Modify: `landing-page/src/pamela-en/style.css`

**Interfaces:**
- Consumes: `{{asset:hero-pamela}}`, `{{asset:logo-brainspotting}}`, `{{asset:logo-brainspotting-id}}`, `{{asset:logo-reattach}}`, `{{asset:logo-capacitar}}`.
- Produces: `#credential-badge`, `a#cta-book`, `a.cta-contact` — `verify.mjs` asserts all three.

- [ ] **Step 1: Add the hero markup inside `<main>`**

```html
<section class="hero">
  <div class="hero__text">
    <h1>Pamela Anggia Dewi, M.Psi., Psikolog</h1>
    <p id="credential-badge" class="badge">Certified International Brainspotting Consultant &amp; Therapist</p>
    <p class="hero__lead">I am a clinical psychologist and an internationally certified psychotherapist. I work across self-healing, self-regulation, performance enhancement, and personal growth — through an integrative approach drawing on the psychotherapies I have trained in deeply: Brainspotting, ReAttach, and a range of Capacitar techniques (Tai Chi dance, EFT, fingerholds, and more).</p>
    <p class="hero__actions">
      <a id="cta-book" class="btn btn--primary" href="https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/">Book Appointment</a>
      <a class="btn btn--ghost cta-contact" href="https://wa.me/628115424069">Contact Me</a>
    </p>
  </div>
  <div class="hero__figure">
    <img src="{{asset:hero-pamela}}" width="900" height="1273" alt="Pamela Anggia Dewi">
  </div>
</section>
```

- [ ] **Step 2: Add the credential strip below it**

```html
<section class="credentials">
  <p class="eyebrow">Trained &amp; Certified In</p>
  <ul class="credentials__logos">
    <li><img src="{{asset:logo-brainspotting}}" alt="Brainspotting"></li>
    <li class="chip--dark"><img src="{{asset:logo-brainspotting-id}}" alt="Brainspotting Indonesia"></li>
    <li><img src="{{asset:logo-reattach}}" alt="ReAttach Academy"></li>
    <li><img src="{{asset:logo-capacitar}}" alt="Capacitar Nusantara"></li>
  </ul>
  <p class="credentials__note">Brainspotting is a brain–body psychotherapy that works with a fixed point of gaze to reach experiences held deeper than words. I use it alongside ReAttach and Capacitar, combining the three to suit each person I work with.</p>
</section>
```

`chip--dark` is the fix for the white logo. Do not recolour the file — the file is fine, the old background was wrong.

- [ ] **Step 3: Style both sections**

Requirements, not a paste-in — write CSS that satisfies them and matches the tokens from Task 2 Step 3:

- `.hero` uses `background: var(--hero)`; two columns above 900 px, text first and single-column below.
- `h1` clamps roughly `2rem`–`3.25rem`; tight leading; no orphan-prone fixed sizes.
- `#credential-badge` must read as a badge, not a subtitle: `#B45A12` text on a pale amber fill, `border: 1px solid` at ~35% amber, pill radius, `font-weight: 600`, `display: inline-block`. It sits directly under `h1` with no more than 12 px between them.
- `.hero__figure img` caps at ~420 px wide on desktop, ~260 px on phone. The PNG is a transparent cut-out — no card, no border, no shadow behind it.
- `.btn--primary`: near-black fill, white text. `.btn--ghost`: transparent, `1.5px` near-black border. Both ≥ 44 px tall for touch.
- `.credentials` on white. `.credentials__logos` is a flex row, wrapping, centred, `list-style: none`, logos capped at 40 px tall and `filter: grayscale(1)` at rest lifting to full colour on hover — except `.chip--dark`, which gets a `#17181A` background, 8 px padding, 6 px radius, and **no** grayscale.
- **The badge must fit above the fold at 390×844.** Test it, do not assume it.

- [ ] **Step 4: Build and check the two new assertions**

```bash
SKIP_UNUSED_CHECK=1 node landing-page/src/pamela-en/build.mjs && \
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify.mjs
```

Expected now PASS: `book links correct`, `contact links correct`, both `credential badge above the fold` lines, all three `no horizontal overflow`. Still FAIL: `images present` (5 of 13), the three stats, the FAQ checks.

- [ ] **Step 5: Screenshot the hero at both widths and look at it**

```bash
cat > /tmp/shot.mjs <<'EOF'
import { chromium } from 'playwright';
const FILE = process.cwd() + '/landing-page/pamela-anggia-dewi-en.html';
const b = await chromium.launch();
for (const [w, h, tag] of [[1440, 900, 'desktop'], [390, 844, 'phone']]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto('file://' + FILE, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/pamela-${tag}.png`, fullPage: true });
  await p.close();
}
await b.close();
EOF
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node /tmp/shot.mjs
```

Open both. Confirm the badge is unmissable, the portrait is not clipped, and the four logos sit on one line on desktop.

- [ ] **Step 6: Commit**

```bash
git add landing-page/src/pamela-en/index.html landing-page/src/pamela-en/style.css
git commit -m "feat(landing-page): hero and credential strip

Puts the Brainspotting credential directly under the name as a badge and
follows it with the four modality logos, which the old page buried in a
Member Of row at the very bottom. The client's note was explicit that
this is what people search for.

Brainspotting Indonesia's logo is white. The old page laid it on white
and it was invisible; here it sits on a dark chip. The file is unchanged."
```

---

### Task 5: Stats, About, Services

Sections 3-5. The three corrected numbers land here.

**Files:**
- Modify: `landing-page/src/pamela-en/index.html`
- Modify: `landing-page/src/pamela-en/style.css`

**Interfaces:**
- Produces: `#stat-years`, `#stat-clients`, `#stat-hours` — `verify.mjs` asserts the text of each.

- [ ] **Step 1: Add the stats band**

The numbers are the client's correction: 13 → 16+, 800-1000 → 1,500+, ≥5500 → 8,000+.

```html
<section class="stats">
  <dl>
    <div><dt id="stat-years">16+</dt><dd>Years of Experience</dd></div>
    <div><dt id="stat-clients">1,500+</dt><dd>Clients</dd></div>
    <div><dt id="stat-hours">8,000+</dt><dd>Hours with Clients</dd></div>
  </dl>
</section>
```

`#stat-*` must be on the element holding **only** the number — `verify.mjs` reads `textContent`, and a label inside would still pass but makes the check meaningless.

- [ ] **Step 2: Add About Me**

```html
<section class="about">
  <h2>About Me</h2>
  <p>I believe every person carries the capacity to heal, and a quality within them ready to shine outward — to give meaning to their own life and to the lives of others. My calling is to offer my clients the chance at a new quality of life.</p>
  <p>It is a great joy to walk beside a client and watch them become whole, restored, and reacquainted with who they truly are.</p>
  <p>My clients come from every stage of life — children, adolescents, adults, and older adults — from within Indonesia and abroad. It would be an honour to accompany you as you find your own true self.</p>
</section>
```

- [ ] **Step 3: Add What I Offer**

```html
<section class="services">
  <p class="eyebrow">Service</p>
  <h2>What I Offer</h2>
  <ul class="services__list">
    <li>Individual Counselling &amp; Psychotherapy</li>
    <li>Couples &amp; Family Counselling &amp; Psychotherapy</li>
    <li>Group Psychotherapy</li>
  </ul>
</section>
```

Three titles, no descriptions. The source has none, and inventing them would be inventing clinical claims.

- [ ] **Step 4: Style all three**

- `.stats` fills `var(--amber)` edge to edge, near-black text. Three columns above 700 px, stacked below. `dt` around `clamp(2.5rem, 6vw, 4rem)`, weight 800, `line-height: 1`. `dd` has `margin-inline-start: 0` — browsers indent `dd` by default and it will look misaligned otherwise.
- `.about` on `var(--surface)`, measure capped at ~68ch, centred.
- `.services__list` is `list-style: none` with cards: white, `1px solid var(--line)`, 12 px radius, generous padding, `var(--orange-ink)` rule or check mark. Three across on desktop, one on phone. Equal heights via grid.
- Section rhythm: give every `section` consistent vertical padding via one rule rather than per-section values.

- [ ] **Step 5: Build and verify**

```bash
SKIP_UNUSED_CHECK=1 node landing-page/src/pamela-en/build.mjs && \
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify.mjs
```

Expected now PASS: `16+ years`, `1,500+ clients`, `8,000+ hours`, and overflow still clean at all three widths.

- [ ] **Step 6: Commit**

```bash
git add landing-page/src/pamela-en/index.html landing-page/src/pamela-en/style.css
git commit -m "feat(landing-page): stats, About Me, and services

Carries the client's three corrections: 13 -> 16+ years, 800-1000 ->
1,500+ clients, >=5500 -> 8,000+ hours.

Splits the bio, which the old page rendered as one unbroken wall of text
in the hero: the opening paragraph stays in the hero, the rest becomes
About Me."
```

---

### Task 6: Areas of Practice, Motto, FAQ, Member Of, Closing

Sections 6-10, and the FAQ behaviour.

**Files:**
- Modify: `landing-page/src/pamela-en/index.html`
- Modify: `landing-page/src/pamela-en/style.css`
- Modify: `landing-page/src/pamela-en/app.js`

**Interfaces:**
- Consumes: the five `icon-*` and three remaining `logo-*` assets.
- Produces: `#faq` with exactly five `details`, each containing a `p` answer; a second `a#cta-book`-class link and `.cta-contact` in the closing section.

- [ ] **Step 1: Add Areas of Practice**

Copy verbatim from the spec. Five cards, in this order.

```html
<section class="areas">
  <h2>Areas of Practice</h2>
  <ul class="areas__grid">
    <li><img src="{{asset:icon-adults}}" alt=""><h3>Adults</h3><p>Depression, with or without suicide attempts; panic attacks; OCD; sexual violence; bipolar disorder; postpartum depression; anxiety disorders; grief and loss; loneliness; anger management; trauma of many kinds; delusional disorders; questions of sexual orientation; phobias; insomnia; addiction (gambling, alcohol, and others), and more.</p></li>
    <li><img src="{{asset:icon-children}}" alt=""><h3>Children &amp; Adolescents</h3><p>Trauma of many kinds (sexual violence, bullying, feeding trauma); conduct disorder; grief and loss; anxiety disorders; insomnia; Tourette syndrome; ADHD; gadget addiction; autism spectrum disorder; gender dysphoria; questions of sexual orientation; developmental concerns, and more.</p></li>
    <li><img src="{{asset:icon-couples}}" alt=""><h3>Couples &amp; Families</h3><p>Vaginismus; adoption; the relationship between partners; the parent–child relationship; supporting children through their parents' divorce; infidelity; support for breastfeeding mothers; postpartum depression, and more.</p></li>
    <li><img src="{{asset:icon-performance}}" alt=""><h3>Performance Enhancement</h3><p>Working with athletes (children, adolescents, adults); performance anxiety; preparation for military and military-academy selection; public-speaking performance; personal development more broadly.</p></li>
    <li><img src="{{asset:icon-medical}}" alt=""><h3>Psychological Support in Medical Conditions</h3><p>Support for people living with cancer, autoimmune conditions, fibromyalgia, COVID-19 and its aftermath, rare forms of Parkinson's disease, and stroke; preparation for major surgery; and trauma following major surgery.</p></li>
  </ul>
</section>
```

Icons are decorative next to a heading that already names the card — `alt=""` is correct, not an omission.

- [ ] **Step 2: Add the Motto**

```html
<section class="motto">
  <p class="eyebrow">My Motto</p>
  <blockquote><p>“Find your light, rise, and shine.”</p>
    <cite>Pamela Anggia Dewi, M.Psi., Psikolog</cite></blockquote>
</section>
```

- [ ] **Step 3: Add the FAQ**

```html
<section id="faq" class="faq">
  <h2>FAQs</h2>
  <details><summary>Who do you work with?</summary><p>Toddlers, children, adolescents, adults, and older adults.</p></details>
  <details><summary>How do I make an appointment?</summary><p>Click <strong>Book Appointment</strong> on this page.</p></details>
  <details><summary>Can I reschedule a session?</summary><p>Yes. Please confirm no later than the day before.</p></details>
  <details><summary>Can I come in for a session without booking first?</summary><p>No. You'll need to register and complete the intake form first in order to make an appointment.</p></details>
  <details><summary>I'm having difficulty affording this — can I still register?</summary><p>Please reach out to me through the <strong>Contact Me</strong> button on this page.</p></details>
</section>
```

`<details>` is deliberate: the answers stay in the DOM and readable with JavaScript off, which `verify.mjs` asserts. FAQ #5 is the reason the Contact Me button exists — the old page promised a button that was never there.

- [ ] **Step 4: Add Member Of and the closing CTA**

```html
<section class="members">
  <h2>Member Of</h2>
  <ul class="members__logos">
    <li><img src="{{asset:logo-ipk}}" alt="IPK Indonesia, West Java"></li>
    <li><img src="{{asset:logo-himpsi}}" alt="HIMPSI Jabar"></li>
    <li><img src="{{asset:logo-keuskupan}}" alt="Keuskupan Bandung"></li>
  </ul>
</section>

<section class="closing">
  <h2>Ready to begin?</h2>
  <p>Sessions are available for children, adolescents, adults, and older adults, in Indonesia and abroad.</p>
  <p class="closing__actions">
    <a class="btn btn--primary cta-book" href="https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/">Book Appointment</a>
    <a class="btn btn--ghost cta-contact" href="https://wa.me/628115424069">Contact Me</a>
  </p>
  <p class="closing__wa">WhatsApp <a class="cta-contact" href="https://wa.me/628115424069">+62 811-5424-069</a></p>
</section>
```

The second booking link uses class `cta-book`, not a duplicate `id` — `verify.mjs` queries `#cta-book, .cta-book` for exactly this reason.

- [ ] **Step 5: Write the accordion JS**

```js
// Close the other FAQ items when one opens. The page works without this —
// <details> is already functional — so keep it to that one behaviour.
document.querySelectorAll('#faq details').forEach((item, _, all) => {
  item.addEventListener('toggle', () => {
    if (!item.open) return;
    all.forEach(other => { if (other !== item) other.open = false; });
  });
});
```

- [ ] **Step 6: Style the remaining sections**

- `.areas__grid`: `list-style: none`, CSS grid, `repeat(auto-fit, minmax(300px, 1fr))`, equal-height cards (white, `1px solid var(--line)`, 12 px radius). Icon 56 px, heading, then body. **All five cards must be the same height in a row** — the old page's cards ragged and left the fifth stranded alone.
- `.motto`: full-bleed `var(--amber)`. Quote at `clamp(1.6rem, 4vw, 2.6rem)`, weight 700, near-black. `cite` normal style, not italic, at ~0.95rem.
- `.faq details`: white card, `1px solid var(--line)`, radius. `summary` at ≥ 44 px tall, `cursor: pointer`, `list-style: none` plus `::-webkit-details-marker { display: none }`, with a `+`/`−` drawn via `::after` that flips on `[open]`. Answer padding must not collapse against the summary.
- `.members__logos`: same rail treatment as `.credentials__logos` — flex, wrap, centred, capped height, grayscale at rest.
- `.closing`: `var(--surface)`, centred, both buttons, WhatsApp line in `var(--orange-ink)`.
- Add `:focus-visible` outlines for every `a` and `summary`. Nothing else on the page is interactive.

- [ ] **Step 7: Full build with the guard back on**

Every asset is now referenced, so drop the escape hatch:

```bash
node landing-page/src/pamela-en/build.mjs && \
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify.mjs
```

Expected: the build succeeds without `SKIP_UNUSED_CHECK` (proving all 13 assets are used) and every check passes.

- [ ] **Step 8: Screenshot all three widths, full page, and read them**

```bash
cat > /tmp/shot3.mjs <<'EOF'
import { chromium } from 'playwright';
const FILE = process.cwd() + '/landing-page/pamela-anggia-dewi-en.html';
const b = await chromium.launch();
for (const [w, tag] of [[1440, 'desktop'], [768, 'tablet'], [390, 'phone']]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto('file://' + FILE, { waitUntil: 'load' });
  await p.waitForTimeout(600);
  const H = await p.evaluate(() => document.body.scrollHeight);
  for (let y = 0, i = 0; y < H; y += 1800, i++) {
    await p.screenshot({ path: `/tmp/pamela-${tag}-${String(i).padStart(2, '0')}.png`,
      fullPage: true, clip: { x: 0, y, width: w, height: Math.min(1800, H - y) } });
  }
  await p.close();
}
await b.close();
EOF
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node /tmp/shot3.mjs
```

Look at every slice. Things `verify.mjs` cannot catch and you must: ragged card heights, a stranded fifth card, text colliding with the portrait, logos at wildly different optical sizes, amber bands that end mid-content.

- [ ] **Step 9: Commit**

```bash
git add landing-page/src/pamela-en/index.html landing-page/src/pamela-en/style.css landing-page/src/pamela-en/app.js
git commit -m "feat(landing-page): areas of practice, motto, FAQ, members, closing

Completes the page. The FAQ is built on <details>, so answers stay
readable with JavaScript disabled; the JS only closes sibling items.

FAQ #5 tells readers to use the Contact Me button. The old page said the
same thing and had no such button — this one does."
```

---

### Task 7: Handover

**Files:**
- Modify: `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md` (verification section only)

- [ ] **Step 1: Re-run the full pipeline from clean**

```bash
rm -f landing-page/pamela-anggia-dewi-en.html && \
node landing-page/src/pamela-en/build.mjs && \
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify.mjs
```

Expected: builds from committed sources alone and every check passes. This proves a fresh clone can rebuild without the ignored 17 MB archive.

- [ ] **Step 2: Record the actual numbers in the spec**

Under "Verifikasi", note the final file size and the pass count. Replace estimates with measurements.

- [ ] **Step 3: Commit and report**

```bash
git add docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md
git commit -m "docs(spec): record measured results for the Pamela page rebuild"
```

Then hand over: the built file path, its size against the 17 MB original, the verification summary, and the **two open items that need Pamela herself** — the invented Brainspotting explainer sentence, and confirmation that `+62 811-5424-069` is the number she wants published.

---

## Self-Review

**Spec coverage.** All ten sections map to Tasks 4-6. Naskah is quoted verbatim in the markup steps. Palette, links, and the three numbers are Global Constraints and are asserted by `verify.mjs`. The asset table maps to Task 1's `ASSETS`. The white-logo defect is fixed in Task 4 Step 2 and eyeballed in Task 1 Step 6. "No entrance animations" is enforced by the no-JS pass in Task 3. The gitignore note becomes Task 1 Steps 2-3.

**Not covered by an automated check, by design:** whether the page *looks good*. Task 4 Step 5 and Task 6 Step 8 are human-eye gates, and they name what to look for rather than saying "check the design".

**Type consistency.** Ids used in `verify.mjs` and produced in Tasks 4-6 match: `#credential-badge`, `#stat-years`, `#stat-clients`, `#stat-hours`, `#cta-book` / `.cta-book`, `.cta-contact`, `#faq details`. Asset names in Task 1's `ASSETS` match the `{{asset:…}}` tokens in Tasks 4 and 6 — all thirteen, no strays. `SKIP_UNUSED_CHECK` is introduced in Task 2 Step 6 and retired in Task 6 Step 7.
