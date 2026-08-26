// Acceptance checks for the built page. Exits non-zero on any failure.
//
// Needs LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps on this box — see README.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, '../../pamela-anggia-dewi-en.html');
const BOOK = 'https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/';
const WA = 'https://wa.me/6285163652908';
const ASSET_COUNT = 13;

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

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
    alt: i.alt || i.src.slice(-24),
    loaded: i.naturalWidth > 0,
    visible: i.getBoundingClientRect().width > 0 && parseFloat(getComputedStyle(i).opacity) >= 0.99,
  })));
check('images present', imgs.length === ASSET_COUNT, `${imgs.length} images`);
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
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const el = document.querySelector('#credential-badge');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { bottom: b.bottom, vh: innerHeight };
  });
  check(`credential badge above the fold (${label})`, r && r.bottom > 0 && r.bottom <= r.vh,
    r ? `bottom ${r.bottom.toFixed(0)} of ${r.vh}` : 'element missing');
}

// No horizontal overflow at any width.
for (const w of [390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 900 });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`no horizontal overflow at ${w}px`, over <= 1, `${over}px`);
}
await ctx.close();

// --- without JavaScript ---
//
// This is the regression test for how the old page failed. It set opacity:0 on
// every large photo and restored it from JavaScript, so the portrait and all
// seven logos vanished whenever that JavaScript did not run.
const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
const p2 = await noJs.newPage();
await p2.goto('file://' + FILE, { waitUntil: 'load' });
const readable = await p2.evaluate(() => ({
  answers: document.querySelectorAll('#faq details p').length,
  textLen: document.body.innerText.length,
  visibleImgs: [...document.images].filter(i => parseFloat(getComputedStyle(i).opacity) >= 0.99).length,
}));
check('FAQ answers in the DOM without JS', readable.answers === 5, `${readable.answers}`);
check('page readable without JS', readable.textLen > 3000, `${readable.textLen} chars`);
check('images not hidden without JS', readable.visibleImgs === ASSET_COUNT, `${readable.visibleImgs} visible`);
await noJs.close();
await browser.close();

for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
