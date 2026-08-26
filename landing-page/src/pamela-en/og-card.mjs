// Generates og-card.jpg — the 1200x630 image link previews show.
//
// Without an og:image, scrapers fall back to whatever they can find; on the live
// site that was the PraktiQu logo. The cut-out portrait cannot be used directly
// either: it is transparent, and transparency renders black in several chat
// clients. This composites it onto the page's own amber gradient.
//
// JPEG, not WebP: WebP support in link-preview scrapers is still uneven.
//
// Needs LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps — see README.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'og-card.jpg');

const portrait = `data:image/webp;base64,${fs.readFileSync(path.join(HERE, 'assets/hero-pamela.webp')).toString('base64')}`;
const bsLogo = `data:image/webp;base64,${fs.readFileSync(path.join(HERE, 'assets/logo-brainspotting.webp')).toString('base64')}`;

const html = `<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    display: flex; align-items: flex-end;
    background: radial-gradient(at center right, #F2CD72 0%, #FFFFFF 100%);
    font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #17181A; -webkit-font-smoothing: antialiased;
  }
  .text { flex: 1 1 auto; padding: 0 0 58px 64px; }
  h1 { font-size: 60px; font-weight: 800; line-height: 1.05; letter-spacing: -0.025em; max-width: 15ch; }
  .badge {
    display: inline-block; margin-top: 22px; padding: 12px 22px;
    border: 1px solid #E9CE93; border-left: 5px solid #F0904A;
    border-radius: 4px 14px 14px 4px; background: #FDF3DC;
    color: #B45A12; font-weight: 700; font-size: 27px; line-height: 1.3;
    max-width: 560px;
  }
  .mark { display: flex; align-items: center; gap: 14px; margin-top: 30px; }
  .mark img { height: 30px; width: auto; }
  .mark span { font-size: 19px; font-weight: 600; color: #4A4E56; }
  .figure { flex: 0 0 auto; height: 100%; display: flex; align-items: flex-end; padding-right: 40px; }
  .figure img { height: 610px; width: auto; display: block; }
</style>
<div class="text">
  <h1>Pamela Anggia Dewi, M.Psi., Psikolog</h1>
  <p class="badge">Certified International Brainspotting Consultant &amp; Therapist</p>
  <div class="mark"><img src="${bsLogo}" alt=""><span>16+ years · 1,500+ clients</span></div>
</div>
<div class="figure"><img src="${portrait}" alt=""></div>`;

const tmp = path.join(HERE, '.og-card.html');
fs.writeFileSync(tmp, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto('file://' + tmp, { waitUntil: 'load' });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT, type: 'jpeg', quality: 88 });
await browser.close();
fs.unlinkSync(tmp);

const kb = fs.statSync(OUT).size / 1024;
console.log(`og-card.jpg  1200x630  ${kb.toFixed(0)} KB`);
if (kb > 300) throw new Error('og:image over 300 KB — some scrapers skip large images');
