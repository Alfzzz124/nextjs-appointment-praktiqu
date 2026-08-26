// Does the page still look right when pasted into an Elementor HTML widget?
//
// Pasting the whole document into a widget works: the browser drops <html>,
// <head> and <body> and keeps <style> plus the content. What it does not drop is
// the theme's own CSS, and two of this page's declarations lose that fight —
// heading font/colour to Elementor's kit stylesheet, and button text colour to a
// theme rule that uses !important.
//
// This reproduces a hostile host page and asserts the computed styles. Run it
// after any change to style.css, and after the live theme is updated.
//
// Needs LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps — see README.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import fs from 'node:fs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '../../pamela-anggia-dewi-en.html');

const built = fs.readFileSync(FILE, 'utf8');
// What the browser keeps when you paste a whole document into an HTML widget:
// <html>/<head>/<body> are dropped, <style> and the content survive.
const style = built.match(/<style>([\s\S]*?)<\/style>/)[1];
const body  = built.match(/<main[\s\S]*<\/main>/)[0];
const js    = built.match(/<script>([\s\S]*?)<\/script>/)[1];

// Hostile host page: the Elementor kit + theme rules that actually bite.
const host = `<!doctype html><html lang="id"><head><meta charset="utf-8">
<style>
  /* Elementor kit stylesheet — the real shape of it */
  .elementor-kit-1234 h1, .elementor-kit-1234 h2, .elementor-kit-1234 h3,
  .elementor-kit-1234 h4, .elementor-kit-1234 h5, .elementor-kit-1234 h6 {
    color: #1B3A6B; font-family: Georgia, serif; font-weight: 400;
    line-height: 2; letter-spacing: 0.05em; font-size: 22px;
  }
  .elementor-kit-1234 p { color: #6b6b6b; }
  .elementor-kit-1234 a { color: #1B3A6B; }
  /* Theme rule on links inside a widget — this is what killed the button text */
  .elementor-widget-container a { color: #555 !important; }
  body { font-family: Georgia, serif; color: #333; line-height: 1.9; }
</style></head>
<body class="elementor-kit-1234">
  <header style="padding:20px;background:#eee;font-size:14px">TEMA: header situs</header>
  <div class="elementor-widget-container">
    <style>${style}</style>
    ${body}
  </div>
  <footer style="padding:20px;background:#eee;font-size:14px">TEMA: footer situs</footer>
  <script>${js}</script>
</body></html>`;

const tmp = path.join(HERE, '.embed-test.html');
fs.writeFileSync(tmp, host);

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto('file://' + tmp, { waitUntil: 'load' });
await p.waitForTimeout(800);

const probe = await p.evaluate(() => {
  const g = (sel, prop) => {
    const el = document.querySelector(sel);
    if (!el) return 'MISSING';
    return getComputedStyle(el)[prop];
  };
  return {
    'h1 color':               g('.lp h1', 'color'),
    'h1 font':                g('.lp h1', 'fontFamily').split(',')[0],
    'h1 weight':              g('.lp h1', 'fontWeight'),
    'h1 line-height':         g('.lp h1', 'lineHeight'),
    'h1 size':                g('.lp h1', 'fontSize'),
    'h2 font':                g('.lp .about h2', 'fontFamily').split(',')[0],
    'stats dt font':          g('.lp .stats dt', 'fontFamily').split(',')[0],
    'motto font':             g('.lp .motto blockquote p', 'fontFamily').split(',')[0],
    'h2 About color':         g('.lp .about h2', 'color'),
    'h3 card color':          g('.lp .areas__grid h3', 'color'),
    'stats dt color':         g('.lp .stats dt', 'color'),
    'primary btn text':       g('.lp a.btn--primary', 'color'),
    'primary btn bg':         g('.lp a.btn--primary', 'backgroundColor'),
    'ghost btn text':         g('.lp a.btn--ghost', 'color'),
    'badge color':            g('.lp .badge', 'color'),
    'lead color':            g('.lp .hero__lead', 'color'),
    'body font (theme)':      getComputedStyle(document.body).fontFamily.split(',')[0],
    'lp font':                g('.lp', 'fontFamily').split(',')[0],
    'header leaked?':         getComputedStyle(document.querySelector('header')).fontFamily.split(',')[0],
  };
});

const want = {
  'h1 color': 'rgb(23, 24, 26)',
  'h2 About color': 'rgb(23, 24, 26)',
  'h3 card color': 'rgb(23, 24, 26)',
  'stats dt color': 'rgb(23, 24, 26)',
  'primary btn text': 'rgb(255, 255, 255)',
  'primary btn bg': 'rgb(23, 24, 26)',
  'ghost btn text': 'rgb(23, 24, 26)',
  'badge color': 'rgb(180, 90, 18)',
  'lead color': 'rgb(74, 78, 86)',
  'h1 font': '"Plus Jakarta Sans"',
  'h2 font': '"Plus Jakarta Sans"',
  'stats dt font': '"Plus Jakarta Sans"',
  'motto font': '"Plus Jakarta Sans"',
  'h1 weight': '800',
  'h1 line-height': '59.8px',
  'h1 size': '52px',
};
let bad = 0;
for (const [k, v] of Object.entries(probe)) {
  const exp = want[k];
  const ok = exp === undefined ? null : v === exp;
  if (ok === false) bad++;
  console.log(`${ok === null ? '   ' : ok ? 'OK ' : 'BAD'}  ${k.padEnd(20)} ${v}${ok === false ? `   want ${exp}` : ''}`);
}
await p.screenshot({ path: path.join(HERE, '.embed-test.png'), clip: { x: 0, y: 0, width: 1440, height: 900 } });
await b.close();
console.log(bad ? `\n${bad} overridden` : '\nall asserted properties survived the theme');
process.exit(bad ? 1 : 0);
