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

// Replacements pass a FUNCTION, never a string. With a string, a `$&` inside the
// CSS or JS is read as "the matched text" and silently injects itself into the
// output. landing-page/tools/inline.mjs documents the same trap.
const html = template
  .replace('{{style}}', () => css)
  .replace('{{script}}', () => js)
  .replace(/\{\{asset:([a-z0-9-]+)\}\}/g, (_, name) => {
    const uri = assets.get(name);
    if (!uri) {
      throw new Error(`unknown asset "${name}" — assets/ has: ${[...assets.keys()].join(', ')}`);
    }
    used.add(name);
    return uri;
  });

const unused = [...assets.keys()].filter(n => !used.has(n));
if (unused.length && !process.env.SKIP_UNUSED_CHECK) {
  throw new Error(`assets never referenced: ${unused.join(', ')}`);
}

const leftover = html.match(/\{\{[^}]+\}\}/g);
if (leftover) throw new Error(`unreplaced token ${leftover[0]}`);

fs.writeFileSync(OUT, html);
const kb = fs.statSync(OUT).size / 1024;
console.log(`${path.relative(process.cwd(), OUT)}  ${kb.toFixed(0)} KB`);
if (kb > 600) throw new Error(`over the 600 KB budget by ${(kb - 600).toFixed(0)} KB`);
