# Memasang halaman Pamela ke WordPress praktiqu.com

**Target:** `https://praktiqu.com/profesional/pamela-anggia-dewi-m-psi-psikolog/`
CPT `profesional`, tiap post diedit dengan Elementor. Slug harus tetap.

**Sumber:** `landing-page/pamela-anggia-dewi-en.html` (325 KB, dokumen utuh)
Desain: `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md`

---

## Kenapa warna font ketimpa

Bukan kebetulan, dan bukan salah widget HTML-nya. Tiga hal bekerja sekaligus.

**1. File itu dokumen utuh, bukan potongan.**
Dia punya `<!doctype>`, `<html>`, `<head>`, dan `<style>` sendiri. Waktu ditempel ke widget
HTML, parser browser membuang keempat tag itu dan menyisakan isi `<body>` plus `<style>`
yang melayang di tengah halaman. Yang tinggal adalah CSS-ku dan CSS tema di satu dokumen
yang sama, saling berebut.

**2. CSS-ku memakai selektor generik.**
`section`, `img`, `p`, `h1, h2, h3` — semuanya spesifisitas (0,0,1). Sangat mudah dikalahkan.

**3. Elementor menyuntik aturan yang lebih spesifik dari itu.**
Site Settings → Typography menghasilkan stylesheet "kit" berisi aturan seperti:

```css
.elementor-kit-1234 h2 { color: var(--e-global-color-secondary); font-family: "…"; }
.elementor-widget-text-editor { color: var(--e-global-color-text); }
```

`.elementor-kit-1234 h2` itu (0,1,1). Melawan `h2` milikku yang (0,0,1), dia menang —
tak peduli urutan pemuatan. **Itu sebabnya yang ketimpa cuma "beberapa" warna:** yang kalah
adalah elemen yang kuwarnai lewat selektor tag atau kelas tunggal, sementara yang kuwarnai
lewat kelas yang lebih spesifik lolos.

Perhatikan juga: aturan Elementor memakai `var(--e-global-color-*)`. Jadi yang menimpa
bukan satu warna tetap, melainkan palet global situsmu.

---

## Diagnosis: pastikan dulu, jangan menebak

Sebelum mengubah apa pun, buktikan siapa yang menimpa. Ini 30 detik dan menghemat
jam-jam menembak dalam gelap.

1. Buka halaman live, klik kanan elemen yang warnanya salah → **Inspect**.
2. Di panel **Styles**, lihat dari atas. Aturan paling atas yang tidak dicoret adalah
   pemenangnya.
3. Catat selektornya. Polanya memberi tahu sumbernya:

| Selektor yang menang | Sumbernya | Perbaikan |
|---|---|---|
| `.elementor-kit-NNNN …` | Elementor → Site Settings → Typography/Colors | Scoping + naikkan spesifisitas |
| `.elementor-widget-container …`, `.elementor-widget-text-editor` | Elementor level widget | Sama |
| Selektor bernama tema (mis. `.kivicare-…`, `.theme-…`) | Stylesheet tema | Sama |
| Apa pun dengan `!important` | Bisa tema, bisa kit | Butuh `!important` balasan — lihat catatan di bawah |

Kalau ternyata pemenangnya pakai `!important`, bilang — penanganannya beda dan sebaiknya
tidak ditebak.

---

## Opsi 1 — Elementor Canvas + CSS ter-scope ⭐ rekomendasi

Dua langkah, dan keduanya perlu. Canvas membuang tema, scoping membuang sisa Elementor.

### Langkah 1: ubah template halaman ke Elementor Canvas

Di editor Elementor, ikon gerigi kiri-bawah (**Page Settings**) → **Page Layout** →
**Elementor Canvas**.

Canvas merender halaman tanpa header, tanpa footer, dan tanpa `wp_body_open` tema — praktis
hanya `wp_head`, kontenmu, dan `wp_footer`. Sebagian besar CSS tema tidak ikut dimuat.

**Ini yang perlu kamu putuskan lebih dulu:** halaman Pamela dirancang tanpa header dan
footer — itu keputusanmu di awal. Tapi 20 halaman `profesional` lain punya nav situs. Kalau
hanya Pamela yang Canvas, halamannya jadi satu-satunya tanpa nav. Kalau itu tidak
diinginkan, pakai template default dan lewati langkah ini — scoping di Langkah 2 tetap
bekerja, hanya saja CSS tema ikut dimuat dan perlu diawasi lebih ketat.

*Kalau "Elementor Canvas" tidak muncul di daftar:* CPT `profesional` belum diaktifkan untuk
Elementor. Cek **Elementor → Settings → General → Post Types**, pastikan `profesional`
tercentang.

### Langkah 2: scope seluruh CSS

Bungkus semua konten dalam satu wrapper, lalu prefiks **setiap** selektor dengan wrapper itu
**dua kali**:

```html
<div class="pam-lp">
  … isi <body> …
</div>
<style>
.pam-lp.pam-lp h2 { color: #17181A; }
.pam-lp.pam-lp .badge { … }
</style>
```

Kenapa dua kali? `.pam-lp.pam-lp h2` bernilai **(0,2,1)**. Itu mengalahkan
`.elementor-kit-1234 h2` yang (0,1,1) tanpa perlu satu pun `!important`. Menulis kelas yang
sama dua kali dalam satu compound selector adalah CSS yang sah dan memang menghitung ganda
— trik lama, dan lebih bersih daripada perang `!important`.

Prefiks satu kali (`.pam-lp h2`, juga (0,1,1)) hanya *seri* dengan aturan kit, dan
pemenangnya lalu ditentukan urutan pemuatan — yang tidak kamu kendalikan. Jangan andalkan itu.

Lalu setel ulang properti yang **diwarisi** di wrapper, karena warisan tidak dikalahkan oleh
spesifisitas:

```css
.pam-lp.pam-lp {
  color: #17181A;
  font-family: "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  text-align: left;
}
```

### Langkah 3: pindahkan gambar ke Media Library

**Ini bukan opsional.** Elementor menyimpan halaman sebagai JSON di postmeta
`_elementor_data`, dan editornya memutar-balik JSON itu lewat browser setiap kali menyimpan.
325 KB base64 di sana akan membuat editor berat dan berpotensi gagal menyimpan.

Unggah 13 berkas dari `landing-page/src/pamela-en/assets/` ke Media Library, lalu ganti tiap
`src="data:image/webp;base64,…"` dengan URL-nya. HTML-nya turun dari 325 KB ke sekitar 30 KB,
dan gambar dapat cache header yang benar.

Catatan: unggah WebP butuh WordPress 5.8+. Kalau ditolak, WP-nya lebih tua dari itu.

---

## Opsi 2 — Shadow DOM: isolasi sempurna, tapi jangan

Ada cara membuat CSS tema **mustahil** menembus, tanpa scoping sama sekali: render ke dalam
shadow root.

```html
<div id="pam-lp"></div>
<script>
  const root = document.getElementById('pam-lp').attachShadow({ mode: 'open' });
  root.innerHTML = '<style> … CSS apa adanya … </style> … HTML apa adanya …';
</script>
```

CSS di luar shadow root tidak bisa menyentuh isinya. CSS-ku dipakai persis tanpa diubah.

**Tapi jangan pakai ini untuk halaman Pamela.** Isinya jadi hidup di dalam JavaScript.
Seluruh alasan halaman ini ada adalah supaya orang menemukannya lewat pencarian
"Brainspotting" — itu kata-kata kliennya sendiri, dan itu juga sebabnya kata kunci itu masuk
`<title>`. Menaruh isi di balik JS adalah risiko SEO yang tidak sepadan di halaman yang
tugasnya justru ditemukan.

Pantas dipakai untuk widget internal atau dasbor. Tidak untuk landing page.

---

## Yang jangan dipakai

**`@layer`.** Terdengar seperti jawabannya, dan justru sebaliknya: dalam cascade, CSS
**tanpa** layer menang atas CSS ber-layer. Membungkus CSS-ku dalam `@layer` membuatnya
kalah dari semua CSS tema, bukan menang.

**`iframe` dengan `srcdoc`.** Isolasi sempurna, tapi tinggi iframe tidak ikut isinya, jadi
butuh JS pengukur tinggi, dan isinya tetap tak terbaca mesin pencari. Masalah SEO yang sama
dengan Shadow DOM, ditambah masalah layout.

**Menempel `<html>`/`<head>` apa adanya.** Browser membuangnya. Kalau kamu sudah menempel
file utuh ke widget dan sebagian tampak jalan, yang kamu lihat adalah sisa-sisa setelah
parser membuang separuh strukturnya.

---

## Ringkasan pilihan

| | Fidelitas | Bisa diedit di Elementor | SEO | Usaha |
|---|---|---|---|---|
| Canvas + CSS ter-scope | Tinggi | Ya | Utuh | Sedang — sekali scoping |
| Template default + CSS ter-scope | Sedang | Ya | Utuh | Sedang, plus awasi CSS tema |
| Shadow DOM | Sempurna | Ya | **Berisiko** | Rendah |
| Template mu-plugin | Sempurna | Tidak | Utuh | Rendah, tapi butuh akses berkas |

Untuk halaman ini: **Canvas + CSS ter-scope**.

---

## Kalau nanti 20 halaman berikutnya menyusul

Scoping manual per halaman tidak akan menyenangkan. Kalau sudah sampai ke sana, jalur yang
lebih baik adalah template lewat mu-plugin — satu route, satu folder HTML, nol tabrakan CSS,
kebal update tema. Fidelitasnya sempurna; harganya halaman tidak lagi bisa diedit di
Elementor. Untuk 21 halaman yang dibangun dari repo, itu pertukaran yang wajar.

Halaman ini dulu saja, pakai Canvas. Putuskan yang itu kalau memang jadi 21.
