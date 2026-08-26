#!/usr/bin/env node
/** Bangun halaman indeks preview dari daftar file di folder ini. */
import { readdirSync, statSync, writeFileSync } from 'node:fs';

const META = {
  'demo-1-hijau': ['38904', 'Professional Page Demo Final 1 — #36A592 HIJAU', 'publish'],
  'demo-3': ['39352', 'Professional Page Demo Final 3', 'publish'],
  'demo-4': ['39422', 'Professional Page Demo Final 4', 'publish'],
  'demo-5': ['39428', 'Professional Page Demo Final 5', 'publish'],
  'demo-6-black': ['39433', 'Professional Page Demo Final 6 — BLACK', 'draft'],
  'demo-7': ['39438', 'Professional Page Demo Final 7', 'draft'],
  'demo-3-green': ['40017', 'Page Demo Final 3 Green', 'draft'],
  'demo-6-hira-yuki': ['40677', 'Professional Page Demo Final 6 — Hira Yuki', 'draft'],
  'psikolog-hira-yuki-molira': ['40787', 'Hira Yuki Molira, M.Psi., Psikolog', 'publish'],
  'psikolog-mutiara-pertiwi': ['40996', 'Mutiara Pertiwi', 'publish'],
  'psikolog-maya-harry': ['41594', 'Maya Harry', 'publish'],
  'psikolog-roellya-a-tyas': ['42358', 'Roellya A Tyas', 'publish'],
  'psikolog-agitya-putri': ['42390', 'Agitya Yanifa Putri, M.Psi., Psikolog', 'publish'],
  'terapis-siti-maulany': ['43200', 'Siti Maulany, S.Psi', 'publish'],
  'psikolog-indriyani-virginia': ['45484', 'Indriyani Virginia, M.Psi., Psikolog', 'publish'],
  'psikolog-surayya-sakinah': ['47359', 'Surayya Sakinah, S.Psi, M.Psi, Psikolog', 'publish'],
  'psikolog-dianda-azani': ['39587', 'Dianda Azani', 'publish'],
  'psikolog-pamela-anggia-dewi': ['42255', 'Pamela Anggia Dewi', 'publish'],
  'psikolog-fridya-mayasari': ['43850', 'Fridya Mayasari, S.Psi, Psikolog, EPC', 'publish'],
  'psikolog-catur-wahyuti': ['44891', 'Catur Wahyuti, S.Psi., M.Psi., Psikolog', 'publish'],
  'psikolog-fauzia-wati': ['46458', 'Fauzia Wati, S.Psi., M.Psi., Psikolog', 'publish'],
  'psikolog-eko-yanita': ['46771', 'Eko Yanita H, M.Psi, Psikolog', 'publish'],
  'psikolog-andi-zainuddin': ['47299', 'Andi Zainuddin Japeri, M.Psi, Psikolog', 'publish'],
  'psikolog-medwin-wisnu-prabowo': ['40424', 'Medwin Wisnu Prabowo', 'draft'],
  'psikolog-dimas-danang': ['41313', 'Dimas Danang, S.Psi., M.Psi., Psikolog, CH., CHt.', 'draft'],
  'psikolog-dzakiyyah-nur-afifah': ['44588', 'Dzakiyyah Nur Afifah, M.Psi., Psikolog', 'draft'],
  'psikolog-diana-krisfie': ['45916', 'Diana Krisfie Rahma Nugraha, M.Psi., Psikolog', 'draft'],
  'psikolog-mutiara-sadjad': ['46583', 'Mutiara Sadjad, S.Psi, M.Psi, Psikolog', 'draft'],
  'psikolog-winda-ruliana': ['41048', 'Winda Ruliana', 'draft'],
};

const files = readdirSync('.').filter((f) => f.endsWith('.html') && f !== 'index.html').sort();
const BASE = process.env.LP_BASE ?? '/landing-page';
const mb = (n) => (n / 1048576).toFixed(1);

const row = (f) => {
  const key = f.replace(/\.html$/, '');
  const [id, title, status] = META[key] || ['?', key, '?'];
  return `      <tr>
        <td><a href="${BASE}/${f}" target="_blank" rel="noopener">${title}</a></td>
        <td class="s"><span class="b ${status}">${status}</span></td>
        <td class="s mono">${id}</td>
        <td class="s mono r">${mb(statSync(f).size)} MB</td>
        <td class="s mono"><a href="${BASE}/${f}" target="_blank" rel="noopener">${f}</a></td>
      </tr>`;
};

const demo = files.filter((f) => f.startsWith('demo-'));
const asli = files.filter((f) => !f.startsWith('demo-'));
const total = files.reduce((s, f) => s + statSync(f).size, 0);

const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Preview landing page profesional — Praktiqu</title>
<style>
  :root { --bg:#f6f7fb; --card:#fff; --ink:#1e2236; --dim:#6b7090; --line:#e4e7f0; --accent:#425fad; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#14162a; --card:#1c1f38; --ink:#eef0f8; --dim:#a2a9c8; --line:#2c3054; --accent:#8fa6e8; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; padding:32px 20px 64px; }
  .wrap { max-width:1000px; margin:0 auto; }
  h1 { font-size:23px; margin:0 0 6px; letter-spacing:-.01em; }
  p.lead { color:var(--dim); margin:0 0 26px; font-size:14px; }
  h2 { font-size:15px; margin:30px 0 10px; display:flex; align-items:center; gap:9px; }
  h2 .n { background:var(--accent); color:#fff; border-radius:99px; font-size:11.5px; padding:2px 9px; font-weight:600; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; overflow-x:auto; }
  table { border-collapse:collapse; width:100%; min-width:640px; }
  td, th { padding:9px 13px; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle; }
  th { font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--dim); font-weight:600; }
  tr:last-child td { border-bottom:0; }
  a { color:var(--accent); text-decoration:none; font-weight:500; }
  a:hover { text-decoration:underline; }
  .s { font-size:12.5px; color:var(--dim); }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .r { text-align:right; }
  .b { border-radius:99px; padding:2px 8px; font-size:11px; font-weight:600; }
  .b.publish { background:#e3f2e7; color:#1c6b32; }
  .b.draft { background:#fdf0dd; color:#8a5a11; }
  @media (prefers-color-scheme: dark) {
    .b.publish { background:#1d3b26; color:#8fe0a6; }
    .b.draft { background:#3d3016; color:#f0c579; }
  }
  .note { background:var(--card); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:10px; padding:14px 16px; margin:26px 0 0; font-size:13.5px; }
  .note b { display:block; margin-bottom:5px; }
  .note ul { margin:7px 0 0; padding-left:19px; color:var(--dim); }
  .note li { margin:4px 0; }
</style>
<div class="wrap">
  <h1>Preview landing page profesional</h1>
  <p class="lead">${files.length} halaman ditarik dari WordPress lama (<span class="mono">appointment.praktiqu.com</span>) jadi HTML mandiri &middot; total ${mb(total)} MB &middot; arsip 2026-08-23</p>

  <h2>Template demo <span class="n">${demo.length}</span></h2>
  <div class="card"><table>
    <tr><th>Halaman</th><th>Status</th><th>ID</th><th class="r">Ukuran</th><th>Berkas</th></tr>
${demo.map(row).join('\n')}
  </table></div>

  <h2>Landing page psikolog <span class="n">${asli.length}</span></h2>
  <div class="card"><table>
    <tr><th>Halaman</th><th>Status</th><th>ID</th><th class="r">Ukuran</th><th>Berkas</th></tr>
${asli.map(row).join('\n')}
  </table></div>

  <div class="note">
    <b>Yang perlu diketahui saat menilai preview ini</b>
    <ul>
      <li><b style="display:inline">Status draft</b> artinya halaman itu belum pernah terbit di WordPress — di sana ia membalas 404. Isinya utuh, tapi belum tentu final.</li>
      <li>Tautan navigasi, header, dan footer masih menunjuk <span class="mono">appointment.praktiqu.com</span>. Belum di-rewrite karena tujuan barunya belum ada.</li>
      <li>Form dan booking tidak berfungsi — ini arsip tampilan, bukan aplikasi yang jalan.</li>
      <li>Sebagian teks demo masih lorem ipsum, sesuai aslinya.</li>
      <li>Satu gambar di halaman Maya Harry memang rusak, dan sudah rusak di WordPress-nya sebelum ditarik.</li>
      <li>File font diambil dari Google Fonts CDN, jadi tampilan huruf butuh koneksi internet.</li>
    </ul>
  </div>
</div>
`;

writeFileSync('index.html', html);
console.log(`index.html dibuat — ${files.length} halaman, total ${mb(total)} MB`);
