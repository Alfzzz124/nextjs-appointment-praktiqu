# Memasang halaman Pamela ke WordPress praktiqu.com

**Target:** `https://praktiqu.com/profesional/pamela-anggia-dewi-m-psi-psikolog/`
CPT `profesional`, tiap post diedit dengan Elementor. Slug tetap.

**Sumber:** `landing-page/pamela-anggia-dewi-en.html`
Desain: `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md`

---

## Caranya

Widget **HTML** Elementor, tempel seluruh isi **`pamela-anggia-dewi-en.widget.html`**.

Itu berkas kedua yang dihasilkan `build.mjs` — isinya sama, tapi tanpa `<html>`, `<head>`,
`<body>`, `<title>`, dan `<meta>`. Yang berekstensi `.html` biasa tetap dipakai untuk dibuka
langsung di browser; yang `.widget.html` untuk ditempel. **Jangan tempel yang standalone** —
alasannya di bagian "Kenapa link preview berantakan" di bawah.

Ini sudah dicoba di live dan berhasil. Revisi pertama dokumen ini menyarankan
Elementor Canvas plus scoping seluruh CSS — itu berlebihan, dan salah membaca masalahnya.
Yang sebenarnya terjadi saat kamu menempel dokumen utuh ke widget:

- `<html>`, `<head>`, `<body>` dibuang parser browser.
- `<style>` dan `<main>` **tetap hidup**, dan CSS-nya tetap berlaku.
- Gambar `data:` URI ikut terbawa, tidak perlu diapa-apakan.

Jadi hampir semuanya jalan. Yang kalah cuma segelintir properti, dan itu sudah ditambal di
`style.css` (blok `surviving a theme` di bagian bawah). Ambil hasil build terbaru dan
tempel ulang — tidak ada langkah manual apa pun untukmu.

---

## Yang dulu salah, dan kenapa

Dua properti kalah dari CSS tema. Keduanya sudah beres, tapi mekanismenya perlu
dicatat — karena kalau tema diupdate dan ada yang rusak lagi, ini peta jalannya.

### 1. Font heading: eksplisit mengalahkan warisan

Aku tidak pernah menyetel `font-family` pada heading — heading mewarisinya dari induk.
Tapi stylesheet "kit" Elementor menyetelnya **eksplisit**:

```css
.elementor-kit-1234 h1, … h6 { font-family: Georgia, serif; color: #1B3A6B; }
```

Deklarasi eksplisit selalu mengalahkan nilai warisan — spesifisitas tidak ikut bicara sama
sekali. Warisan hanya berlaku kalau **tidak ada** deklarasi yang cocok. Itu sebabnya judulmu
tampil dengan font tema, dan itu yang kamu lihat sebagai "font ada yg salah dikit".

Perbaikannya `font-family: inherit` pada heading, dengan spesifisitas yang cukup.

### 2. Teks tombol: `!important` hanya bisa dilawan `!important`

Tema menyetel warna tautan di dalam widget seperti ini:

```css
.elementor-widget-container a { color: #555 !important; }
```

Label putih di tombol gelap jadi abu-abu tema dan nyaris tak terbaca. Itu kegagalan kontras,
bukan selera. Dan `!important` **tidak bisa** dikalahkan spesifisitas seberapa pun tinggi —
hanya `!important` lain yang bisa.

Jadi ada tepat **dua** `!important` di seluruh file, keduanya untuk warna label tombol.

### Trik spesifisitas yang dipakai

Untuk yang bukan `!important`, selektornya menulis kelas induk dua kali:

```css
.lp.lp h1 { … }
```

`.lp.lp h1` bernilai **(0,2,1)**. Itu mengalahkan `.elementor-kit-1234 h1` yang (0,1,1),
tanpa `!important`. Menulis kelas yang sama dua kali dalam satu compound selector adalah CSS
yang sah dan memang dihitung ganda.

Prefiks satu kali (`.lp h1`, juga (0,1,1)) hanya **seri** dengan aturan kit, dan pemenang
seri ditentukan urutan pemuatan — yang tidak kamu kendalikan. Jangan andalkan itu.

### Bonus: font tidak lagi bocor ke tema

Sebelumnya `body { font-family: … }`. Karena tag `<body>` dibuang saat ditempel, aturan itu
mendarat di `<body>` **milik tema** dan menyebarkan Plus Jakarta Sans ke header dan footer
situs. Sekarang tipografi ada di `.lp` (yaitu `<main>`), yang berada di dalam widget. Tes
memverifikasi header tema tetap memakai font aslinya.

---

## Tes regresi

`landing-page/src/pamela-en/verify-embed.mjs` membangun halaman host yang bermusuhan —
kit Elementor yang menyetel warna, font, ukuran, bobot, `line-height`, dan `letter-spacing`
pada semua heading, plus aturan tema `!important` pada tautan widget — lalu memeriksa
computed style hasilnya.

```bash
LD_LIBRARY_PATH=$HOME/.local/share/chromium-deps node landing-page/src/pamela-en/verify-embed.mjs
```

Jalankan setelah mengubah `style.css`, dan setelah tema live diupdate. Kalau ada yang merah,
dia menyebutkan properti mana yang ketimpa dan nilai yang diharapkan.

---

## Kalau ada yang masih salah di live

Buktikan dulu, jangan menebak. 30 detik, dan menghemat jam menembak dalam gelap.

1. Klik kanan elemennya → **Inspect**.
2. Di panel **Styles**, aturan paling atas yang **tidak dicoret** adalah pemenangnya.
3. Kirim selektornya ke sini. Polanya menunjukkan sumbernya:

| Selektor yang menang | Sumbernya |
|---|---|
| `.elementor-kit-NNNN …` | Elementor → Site Settings → Typography / Colors |
| `.elementor-widget-container …` | Aturan tema untuk isi widget |
| Selektor bernama tema | Stylesheet tema |
| Apa pun dengan `!important` | Butuh `!important` balasan |

Perhatikan juga apakah propertinya salah karena **ditimpa** atau karena **diwarisi** —
kalau di panel Styles propertimu tidak muncul sama sekali padahal nilainya salah, itu kasus
warisan seperti nomor 1 di atas, bukan kasus spesifisitas.

---

## Kenapa link preview berantakan

Gejalanya: judul preview terbaca
`Pamela Anggia Dewi, M.Psi., Psikolog – Praktiqu</title><meta name='robots' …`

Aku sempat menyalahkan `<head>` yang rusak. Salah. Diagnosis dari sumber halaman live:

- `<title>` di `<head>` **sempurna**, offset 66–126.
- Tapi ada **`<title>` kedua** di dalam body, offset 84783 — dari file yang ditempel.
- Ada **nol** tag `og:` dan `twitter:` di seluruh halaman.

Scraper yang memungut judul dengan regex greedy `<title>(.*)</title>` akan menyapu dari tag
buka **pertama** sampai tag tutup **terakhir**. Dengan dua `</title>` di dokumen, itu berarti
84 KB markup jadi "judul", lalu dipotong untuk ditampilkan. Persis yang terlihat.

Aku sebelumnya menulis bahwa `<title>` di posisi body itu inert. Inert untuk **render** — itu
sebabnya halamannya tetap tampak benar. Sama sekali tidak inert untuk crawler.

**Perbaikannya:** tempel `pamela-anggia-dewi-en.widget.html`. `build.mjs` sekarang
menghasilkannya tanpa tag head, dan punya guard yang gagal kalau ada yang lolos.

---

## Yang masih perlu dibereskan di WordPress

Tiga hal, dan semuanya di luar file ini karena memang harus ada di `<head>`.

### 1. Tidak ada plugin SEO sama sekali

Nol tag `og:`/`twitter:`. `<meta name='robots' content='max-image-preview:large' />` itu
output WordPress core, bukan Yoast. Karena itu scraper menebak, dan menebaknya jelek.

**Untuk 21 halaman, pasang plugin SEO** (Rank Math atau Yoast). Ia menghasilkan `og:title`,
`og:description`, dan `og:image` otomatis dari tiap post plus featured image-nya — sekali
setel, berlaku untuk semua halaman `profesional` sekarang dan nanti. Menambal tag per halaman
dengan tangan tidak akan terkejar di halaman ke-21.

**Untuk halaman ini saja, sekarang:** Elementor Pro aktif (`pro-elements` ada di markup), jadi
ada **Elementor → Custom Code**, bisa menyuntik ke `<head>` dengan kondisi dibatasi ke satu
halaman:

```html
<meta property="og:type"        content="profile">
<meta property="og:site_name"   content="Praktiqu">
<meta property="og:locale"      content="en_US">
<meta property="og:url"         content="https://praktiqu.com/profesional/pamela-anggia-dewi-m-psi-psikolog/">
<meta property="og:title"       content="Pamela Anggia Dewi, M.Psi., Psikolog — Certified International Brainspotting Consultant &amp; Therapist">
<meta property="og:description" content="Clinical psychologist and internationally certified psychotherapist. 16+ years, 1,500+ clients. Brainspotting, ReAttach and Capacitar.">
<meta property="og:image"       content="https://praktiqu.com/wp-content/uploads/…/og-card.jpg">
<meta property="og:image:width"  content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card"       content="summary_large_image">
```

Unggah `landing-page/src/pamela-en/og-card.jpg` (1200×630, 79 KB) ke Media Library dan
tempelkan URL-nya ke `og:image`. Kartu itu dihasilkan `og-card.mjs` dari aset halaman ini.
Foto cut-out-nya tidak bisa dipakai langsung sebagai `og:image` — latarnya transparan, dan
transparansi tampil **hitam** di beberapa aplikasi chat. Kartunya sudah dikomposit di atas
gradasi amber. Formatnya JPEG, bukan WebP, karena dukungan WebP di scraper preview masih
timpang.

### 2. `<meta name="description">` masih bio Indonesia yang lama

Isinya sekarang seluruh bio Indonesia versi lama — **1.050 karakter**, lengkap dengan frasa
"alatNya" yang justru kamu minta dinetralkan. Dua masalah: bahasanya salah untuk halaman yang
sekarang berbahasa Inggris, dan panjangnya sekitar tujuh kali batas wajar (~155 karakter).

Tidak ada plugin SEO, jadi itu datang dari tempat lain — cek **excerpt** post-nya dulu, lalu
custom field. Yang perlu dipasang:

```
Clinical psychologist and internationally certified psychotherapist. Certified
International Brainspotting Consultant & Therapist — Brainspotting, ReAttach and
Capacitar. 16+ years, 1,500+ clients.
```

### 3. `<html lang="id">` padahal isinya Inggris

Halaman mendeklarasikan dirinya berbahasa Indonesia. Mesin pencari memakai itu untuk
menentukan audiens, dan pembaca layar memakainya untuk memilih pelafalan. Kalau plugin SEO
atau pengaturan bahasa per-post tidak bisa mengubahnya, ini prioritas rendah — tapi catat.

### Judulnya sendiri

Kata kunci **Brainspotting** sengaja masuk `<title>` karena itu yang dicari orang — kata
klien Pamela sendiri. Karena `<title>` dari file tidak terpakai, judul post WordPress-nya
harus disetel:

```
Pamela Anggia Dewi, M.Psi., Psikolog — Certified International Brainspotting
Consultant & Therapist
```

Sekarang judulnya `Pamela Anggia Dewi, M.Psi., Psikolog – Praktiqu`. Kata kuncinya hilang.

---

## Satu hal lagi

**Base64 di `_elementor_data`.** Gambarnya memang terbawa, tapi Elementor menyimpan halaman
sebagai JSON di postmeta dan editornya memutar-balik JSON itu lewat browser tiap kali
menyimpan. Sekarang berjalan; kalau editor mulai berat atau penyimpanan gagal, itu
penyebabnya. Obatnya: unggah 13 berkas di `landing-page/src/pamela-en/assets/` ke Media
Library dan ganti tiap `src="data:image/webp;base64,…"` dengan URL-nya. HTML turun dari
326 KB ke sekitar 30 KB. Tidak perlu dikerjakan selama belum bermasalah.

---

## Kalau 20 halaman berikutnya menyusul

Tempel-per-halaman masih masuk akal untuk 21 halaman, sekarang setelah tidak ada pekerjaan
manual per halaman. Yang perlu diawasi hanya ukuran `_elementor_data` — pada titik itu
pindahkan gambar ke Media Library dulu, lalu 21 halaman jadi 21 tempel yang ringan.

Template lewat mu-plugin (fidelitas sempurna, kebal update tema, tapi tidak bisa diedit di
Elementor) tetap ada sebagai pilihan kalau tempel-menempel jadi beban. Bukan sesuatu yang
perlu diputuskan sekarang.
