// Old Elementor page -> assets/*.webp
//
// Selects each image by its unique `wp-image-NNNN` class, decodes the data: URI,
// and re-encodes it through a canvas in headless Chrome. There is no cwebp and no
// ImageMagick on this machine, and no passwordless sudo to install one.
//
// Run once. Rerun only to change an asset.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../../psikolog-pamela-anggia-dewi.html');
const OUT = path.join(HERE, 'assets');

// name -> [wp-image id, max width px, webp quality]
const ASSETS = {
  'hero-pamela':           [42258, 900, 0.86],
  'icon-adults':           [38977, 220, 0.85],
  'icon-children':         [38979, 220, 0.85],
  'icon-couples':          [38975, 220, 0.85],
  'icon-performance':      [38981, 220, 0.85],
  'icon-medical':          [44178, 220, 0.85],
  'logo-brainspotting':    [42274, 400, 0.90],
  'logo-brainspotting-id': [42326, 400, 0.90],
  'logo-reattach':         [44186, 400, 0.90],
  'logo-capacitar':        [42321, 400, 0.90],
  'logo-ipk':              [42322, 400, 0.90],
  'logo-himpsi':           [42327, 400, 0.90],
  'logo-keuskupan':        [42328, 400, 0.90],
};

const html = fs.readFileSync(SRC, 'utf8');

function findDataUri(wpId) {
  const tags = html.match(new RegExp(`<img[^>]*wp-image-${wpId}[^>]*>`, 'g'));
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
console.log(`\n${Object.keys(ASSETS).length} assets, ${(total / 1024).toFixed(0)} KB total`);
