#!/usr/bin/env node
/**
 * Ubah HTML hasil render WordPress jadi SATU file HTML mandiri.
 *
 * CSS, JS, gambar, dan font di-embed ke dalam dokumen: stylesheet jadi <style>,
 * script jadi <script> inline, aset biner jadi data: URI. Setelah ini file-nya
 * bisa dibuka dari mana saja tanpa menyentuh appointment.praktiqu.com lagi.
 *
 * Aset di bawah wp-content/ dibaca dari disk (jauh lebih cepat dan tak kena WAF);
 * sisanya (mis. Google Fonts) diambil lewat HTTP.
 *
 * Pakai: node inline.mjs <input.html> <output.html>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';

const SITE = 'https://appointment.praktiqu.com';
const DOCROOT = `${process.env.HOME}/appointment.praktiqu.com`;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

const MIME = {
  css: 'text/css', js: 'application/javascript', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf',
};

const stats = { inlined: 0, failed: 0, bytes: 0, misses: [], skippedFonts: 0, skippedBundles: [] };
const cache = new Map();

/** Keluarga font teks yang dialihkan ke Google Fonts CDN: family -> Set("ital,wght"). */
const cdnFonts = new Map();

/** File font yang berasal dari Google (Elementor menyimpannya sendiri di uploads/). */
const isGoogleFont = (u) =>
  /\/uploads\/elementor\/google-fonts\//i.test(u) || /fonts\.gstatic\.com/i.test(u);

/**
 * Bundle yang tidak mungkin mempengaruhi tampilan landing page. Semuanya membawa
 * CSS + font ikonnya sendiri, jadi membuangnya memotong beberapa MB per halaman
 * tanpa mengubah apa pun yang terlihat.
 */
const DENY = [
  /woocommerce/i,
  /kivicare-clinic-management-system\/dist\/assets\/appointment-/i,
  /wp-emoji-release/i,
  /comment-reply/i,
];
const isDenied = (u) => DENY.some((re) => re.test(u));

const extOf = (u) => {
  const m = u.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
};
const mimeOf = (u) => MIME[extOf(u)] || 'application/octet-stream';

/** Ambil satu aset sebagai Buffer — dari disk kalau lokal, kalau tidak lewat HTTP. */
async function fetchAsset(url) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    try {
      // Buang query string versi (?ver=6.4) sebelum memetakan ke path disk.
      const clean = url.split('#')[0];
      if (clean.startsWith(SITE) || clean.startsWith('/')) {
        const rel = clean.startsWith(SITE) ? clean.slice(SITE.length) : clean;
        const path = DOCROOT + decodeURIComponent(rel.split('?')[0]);
        try {
          return await readFile(path);
        } catch {
          /* tidak ada di disk — coba HTTP di bawah */
        }
      }
      const abs = clean.startsWith('//') ? 'https:' + clean
        : clean.startsWith('/') ? SITE + clean
        : clean;
      if (!/^https?:/i.test(abs)) return null;
      const res = await fetch(abs, { headers: { 'User-Agent': UA, Referer: SITE + '/' } });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  })();
  cache.set(url, p);
  return p;
}

function resolveUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl || SITE + '/').href;
  } catch {
    return null;
  }
}

/** Jadikan satu URL sebagai data: URI. */
async function toDataUri(url, baseUrl) {
  const abs = resolveUrl(url, baseUrl);
  if (!abs || /^(data|blob|about|javascript|mailto|tel):/i.test(abs)) return null;
  if (isGoogleFont(abs)) { stats.skippedFonts++; return null; }  // ditangani link CDN
  const buf = await fetchAsset(abs);
  if (!buf) { stats.failed++; if (stats.misses.length < 12) stats.misses.push(abs.slice(0, 110)); return null; }
  stats.inlined++; stats.bytes += buf.length;
  return `data:${mimeOf(abs)};base64,${buf.toString('base64')}`;
}

/**
 * Sisakan hanya woff2 di setiap deklarasi `src:` @font-face.
 *
 * Tiap keluarga font dikirim 4 format (woff2/woff/ttf/eot) untuk browser lama. Meng-embed
 * semuanya menambah ~11MB per halaman tanpa efek apa pun di browser modern — semuanya
 * memilih woff2. Kalau tidak ada woff2 di daftar, biarkan utuh.
 */
function dropLegacyFontFormats(css) {
  // Urutan preferensi: woff2 paling kecil dan didukung semua browser sejak 2016.
  const RANK = [/\.woff2/i, /\.woff(\?|#|['")]|$)/i, /\.ttf/i, /\.otf/i, /\.eot/i, /\.svg/i];
  return css.replace(/src\s*:\s*([^;{}]+)/gi, (whole, list) => {
    const parts = list.split(',').map((x) => x.trim()).filter(Boolean);
    if (parts.length < 2) return whole;
    for (const re of RANK) {
      const hit = parts.filter((x) => re.test(x));
      if (hit.length) return `src:${hit.join(',')}`;
    }
    return whole;
  });
}

/**
 * Hapus blok @font-face yang persis sama isinya.
 *
 * Stylesheet theme/Elementor/plugin masing-masing mendeklarasikan ulang font ikon yang
 * sama, jadi satu font woff2 bisa ter-embed 14 kali. Deklarasi kedua dan seterusnya
 * redundan — @font-face pertama sudah mendaftarkan keluarga itu ke browser.
 */
function dedupeFontFaces(html) {
  const seen = new Set();
  let dropped = 0, saved = 0;
  const out = html.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
    const key = (block.match(/base64,([A-Za-z0-9+/=]{64})/) || [])[1];
    if (!key) return block;
    const id = ((block.match(/font-family\s*:\s*([^;}]+)/i) || [])[1] || '') + '|' +
               ((block.match(/font-weight\s*:\s*([^;}]+)/i) || [])[1] || '') + '|' +
               ((block.match(/font-style\s*:\s*([^;}]+)/i) || [])[1] || '') + '|' + key;
    if (seen.has(id)) { dropped++; saved += block.length; return ''; }
    seen.add(id);
    return block;
  });
  if (dropped) console.log(`   dedupe @font-face: ${dropped} blok, hemat ${(saved / 1048576).toFixed(1)}MB`);
  return out;
}

/**
 * Buang @font-face untuk subset unicode non-latin.
 *
 * CSS Google Fonts yang di-selfhost Elementor memuat tiap keluarga dalam semua subset:
 * cyrillic, cyrillic-ext, greek, greek-ext, vietnamese, latin, latin-ext. Satu keluarga
 * bisa 5MB karenanya. Halaman ini berbahasa Indonesia — hanya latin & latin-ext yang
 * pernah dipakai. Blok tanpa unicode-range tidak disentuh (tidak bisa dipastikan).
 */
/**
 * Catat @font-face milik Google, lalu buang bloknya.
 *
 * Keluarga teks (Inter, Roboto, IBM Plex Sans, ...) diganti satu <link> ke
 * fonts.googleapis.com di akhir proses — jauh lebih ringan daripada meng-embed
 * tiap bobot dalam base64. Font ikon (eicons, FontAwesome, ionicons) TIDAK ikut:
 * tidak tersedia di Google Fonts, jadi tetap di-embed.
 */
function harvestGoogleFonts(css) {
  return css.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
    const src = (block.match(/src\s*:\s*([^;}]+)/i) || [])[1] || '';
    if (!isGoogleFont(src)) return block;
    const fam = ((block.match(/font-family\s*:\s*["']?([^"';}]+)["']?/i) || [])[1] || '').trim();
    if (!fam) return '';
    const w = ((block.match(/font-weight\s*:\s*([^;}]+)/i) || [])[1] || '400').trim().split(/\s+/)[0];
    const ital = /font-style\s*:\s*italic/i.test(block) ? 1 : 0;
    if (!cdnFonts.has(fam)) cdnFonts.set(fam, new Set());
    cdnFonts.get(fam).add(`${ital},${/^\d+$/.test(w) ? w : '400'}`);
    return '';
  });
}

/** Bangun satu URL Google Fonts css2 untuk semua keluarga yang terkumpul. */
function googleFontsLink() {
  if (!cdnFonts.size) return '';
  const fams = [...cdnFonts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([fam, set]) => {
    const pairs = [...set].map((x) => x.split(',').map(Number))
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const name = fam.replace(/\s+/g, '+');
    const hasItal = pairs.some(([i]) => i === 1);
    return hasItal
      ? `family=${name}:ital,wght@${pairs.map(([i, w]) => `${i},${w}`).join(';')}`
      : `family=${name}:wght@${[...new Set(pairs.map(([, w]) => w))].join(';')}`;
  });
  return '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
    + '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap">`;
}

function dropNonLatinSubsets(css) {
  if (!/unicode-range/i.test(css)) return css;
  return css.replace(/@font-face\s*\{[^{}]*\}/gi, (block) => {
    const r = (block.match(/unicode-range\s*:\s*([^;}]+)/i) || [])[1];
    if (!r) return block;
    const latin = /U\+0{0,3}0-0{0,2}FF|U\+0000-00FF|U\+0100-024F|U\+0102-0103|U\+1E00/i.test(r);
    return latin ? block : '';
  });
}

/** Ganti setiap url(...) di dalam CSS jadi data: URI, dan tarik @import secara rekursif. */
async function inlineCss(css, baseUrl, depth = 0) {
  if (depth > 3) return css;
  css = harvestGoogleFonts(dropNonLatinSubsets(dropLegacyFontFormats(css)));

  // @import "x.css" / @import url(x.css)
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s]+)["']?\s*\)?\s*([^;]*);/gi)];
  for (const m of imports) {
    const abs = resolveUrl(m[1], baseUrl);
    let repl = '';
    if (abs) {
      const buf = await fetchAsset(abs);
      if (buf) {
        const media = (m[2] || '').trim();
        let inner = await inlineCss(buf.toString('utf8'), abs, depth + 1);
        repl = media ? `@media ${media}{${inner}}` : inner;
        stats.inlined++; stats.bytes += buf.length;
      } else { stats.failed++; }
    }
    css = css.replace(m[0], () => repl);  // fungsi: $& di dalam CSS jangan ditafsirkan
  }

  // url(...) — lewati yang sudah data:/# (SVG fragment)
  const urls = [...new Set([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]))];
  for (const u of urls) {
    if (/^(data|about):/i.test(u) || u.startsWith('#')) continue;
    const d = await toDataUri(u, baseUrl);
    if (d) {
      css = css.split(`url(${u})`).join(`url(${d})`)
               .split(`url('${u}')`).join(`url('${d}')`)
               .split(`url("${u}")`).join(`url("${d}")`);
    }
  }
  return css;
}

const escStyle = (s) => s.replace(/<\/style/gi, '<\\/style');
const escScript = (s) => s.replace(/<\/script/gi, '<\\/script');

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('usage: node inline.mjs <in.html> <out.html>'); process.exit(2); }
  let html = await readFile(input, 'utf8');
  const before = html.length;
  const contrib = [];

  // ── 1. Buang tag yang tidak berguna di luar WordPress ──────────────────────
  html = html
    .replace(/<link[^>]+rel=["'](?:dns-prefetch|preconnect|profile|EditURI|wlwmanifest|alternate|shortlink|canonical|pingback|next|prev)["'][^>]*>/gi, '')
    .replace(/<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*>/gi, '')
    .replace(/<link[^>]+rel=["']preload["'][^>]*>/gi, '')
    .replace(/<meta[^>]+name=["']generator["'][^>]*>/gi, '')
    .replace(/<link[^>]*href=["'][^"']*wp-json[^"']*["'][^>]*>/gi, '');

  // ── 2. Stylesheet → <style> ────────────────────────────────────────────────
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].filter((m) => /stylesheet/i.test(m[0]));
  const seenSheets = new Set();
  for (const m of links) {
    const href = (m[0].match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const abs = resolveUrl(href);
    if (isDenied(abs || href)) {
      stats.skippedBundles.push(basename((abs || href).split('?')[0]));
      html = html.replace(m[0], ''); continue;
    }
    // Handle WordPress yang berbeda kadang memuat file yang sama dua kali — kadang
    // dari path berbeda pula (salinan theme vs salinan plugin), jadi dedupe-nya
    // berdasarkan isi file, bukan URL-nya.
    const dedupeKey = (abs || href).split('?')[0];
    if (seenSheets.has(dedupeKey)) { html = html.replace(m[0], ''); continue; }
    seenSheets.add(dedupeKey);
    const buf = abs ? await fetchAsset(abs) : null;
    if (!buf) { stats.failed++; if (stats.misses.length < 12) stats.misses.push((abs || href).slice(0, 110)); continue; }
    const contentKey = createHash('sha1').update(buf).digest('hex');
    if (seenSheets.has(contentKey)) { html = html.replace(m[0], ''); continue; }
    seenSheets.add(contentKey);
    stats.inlined++; stats.bytes += buf.length;
    const media = (m[0].match(/media=["']([^"']+)["']/i) || [])[1];
    const id = (m[0].match(/id=["']([^"']+)["']/i) || [])[1] || basename((abs || href).split('?')[0]);
    let css = await inlineCss(buf.toString('utf8'), abs);
    if (media && media !== 'all') css = `@media ${media}{${css}}`;
    contrib.push([css.length, basename((abs || href).split('?')[0])]);
    html = html.replace(m[0], () => `<style data-from="${id}">\n${escStyle(css)}\n</style>`);
  }

  // ── 3. <style> yang sudah inline: tetap perlu url() di-embed ───────────────
  for (const m of [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]) {
    if (!/url\(/i.test(m[1]) || /base64/.test(m[1].slice(0, 200))) continue;
    const css = await inlineCss(m[1], SITE + '/');
    if (css !== m[1]) html = html.replace(m[0], () => m[0].replace(m[1], () => escStyle(css)));
  }

  // ── 4. <script src> → inline ───────────────────────────────────────────────
  // `>\s*</script>`: sebagian plugin menyisipkan newline sebelum tag penutup, dan
  // regex tanpa \s* melewatkan tag-tag itu (backbone, elementor-common-modules, ...).
  for (const m of [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi)]) {
    const abs = resolveUrl(m[1]);
    if (isDenied(abs || m[1])) {
      stats.skippedBundles.push(basename((abs || m[1]).split('?')[0]));
      html = html.replace(m[0], ''); continue;
    }
    const buf = abs ? await fetchAsset(abs) : null;
    if (!buf) { stats.failed++; if (stats.misses.length < 12) stats.misses.push((abs || m[1]).slice(0, 110)); continue; }
    stats.inlined++; stats.bytes += buf.length;
    const keep = /\bid=["']([^"']+)["']/i.exec(m[0]);
    const defer = /\b(defer|async)\b/i.test(m[0]) ? ' defer' : '';
    html = html.replace(m[0], () => `<script${keep ? ` id="${keep[1]}"` : ''}${defer}>\n${escScript(buf.toString('utf8'))}\n</script>`);
  }

  // ── 5. Atribut gambar/media → data: URI ────────────────────────────────────
  for (const attr of ['src', 'data-src', 'data-lazy-src', 'poster', 'content', 'href']) {
    const re = new RegExp(`\\b${attr}=["']([^"']+\\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3))(\\?[^"']*)?["']`, 'gi');
    for (const m of [...html.matchAll(re)]) {
      const d = await toDataUri(m[1] + (m[2] || ''));
      if (d) html = html.split(m[0]).join(`${attr}="${d}"`);
    }
  }

  // ── 6. srcset dibuang, tidak di-embed ──────────────────────────────────────
  // Meng-embed srcset berarti tiap gambar masuk 5-6 kali dalam ukuran berbeda —
  // satu halaman jadi 56MB. `src` sudah jadi data: URI di langkah 5, jadi gambarnya
  // tetap tampil; yang hilang cuma pemilihan resolusi per-viewport.
  html = html.replace(/\s(?:data-)?srcset=["'][^"']*["']/gi, '')
             .replace(/\ssizes=["'][^"']*["']/gi, '');

  // ── 7. style="...url(...)..." di atribut ───────────────────────────────────
  for (const m of [...html.matchAll(/\bstyle=["']([^"']*url\([^"']*\)[^"']*)["']/gi)]) {
    const css = await inlineCss(m[1], SITE + '/');
    if (css !== m[1]) html = html.split(m[0]).join(`style="${css.replace(/"/g, '&quot;')}"`);
  }

  html = dedupeFontFaces(html);

  const gf = googleFontsLink();
  if (gf) html = html.replace(/<\/head>/i, () => `${gf}\n</head>`);

  await writeFile(output, html);
  const mb = (n) => (n / 1048576).toFixed(2) + 'MB';
  if (process.env.LP_REPORT) {
    console.log('   penyumbang CSS terbesar:');
    for (const [n, f] of contrib.sort((a, b) => b[0] - a[0]).slice(0, 10)) {
      console.log(`     ${(n / 1048576).toFixed(2).padStart(6)}MB  ${f}`);
    }
  }
  console.log(`${basename(output)}  ${mb(before)} → ${mb(html.length)}  aset:${stats.inlined} gagal:${stats.failed}`
    + `  fontCDN:${cdnFonts.size} keluarga (${stats.skippedFonts} file tak di-embed)`
    + `  bundle dibuang:${new Set(stats.skippedBundles).size}`);
  if (stats.misses.length) console.log(`   gagal: ${stats.misses.join('\n   gagal: ')}`);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
