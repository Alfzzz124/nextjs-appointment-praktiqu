# Memasang halaman Pamela ke WordPress praktiqu.com

**Target:** `https://praktiqu.com/profesional/pamela-anggia-dewi-m-psi-psikolog/`
CPT `profesional`, tiap post diedit dengan Elementor. Slug tetap.

**Sumber:** `landing-page/pamela-anggia-dewi-en.html`
Desain: `docs/superpowers/specs/2026-08-26-pamela-landing-page-en-design.md`

---

## Caranya: tempel apa adanya

Widget **HTML** Elementor, tempel seluruh isi file. Selesai.

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

## Dua hal yang tidak ikut terbawa

**`<title>` dan `<meta name="description">` mati.** Keduanya ada di dalam file, tapi di posisi
body browser mengabaikannya. Judul dan deskripsi halaman datang dari post WordPress dan
plugin SEO-mu, bukan dari file ini.

Ini penting: kata kunci **Brainspotting** sengaja kutaruh di `<title>` karena itu yang dicari
orang — kata klien Pamela sendiri. Kalau tidak disetel ulang lewat plugin SEO, manfaatnya
hilang. Nilai yang perlu dipasang:

```
Title:       Pamela Anggia Dewi, M.Psi., Psikolog — Certified International
             Brainspotting Consultant & Therapist
Description: Clinical psychologist and internationally certified psychotherapist.
             Certified International Brainspotting Consultant & Therapist, working
             with Brainspotting, ReAttach and Capacitar.
```

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
