# Landing page profesional — arsip HTML mandiri

Hasil tarikan 29 halaman landing page dari WordPress lama (`appointment.praktiqu.com`),
masing-masing jadi **satu file HTML** yang siap dipasang di front-end baru.
Diambil 2026-08-23.

## Isi

| Prefix | Jumlah | Apa ini |
|---|---|---|
| `demo-*.html` | 8 | Template demo — "Professional Page Demo Final 1/3/4/5/6/7", varian hijau, dan varian Hira Yuki |
| `psikolog-*.html`, `terapis-*.html` | 21 | Landing page psikolog yang sudah ada (publish maupun draft) |

Daftar lengkap beserta ID WordPress, slug asal, dan status ada di [`MANIFEST.md`](MANIFEST.md).

## Cara pakai

Buka langsung di browser — tidak perlu server, tidak perlu build. CSS, JavaScript, dan
seluruh gambar sudah tertanam di dalam file (gambar sebagai `data:` URI).

Satu-satunya hal yang masih diambil dari internet adalah **file font**, lewat satu
`<link>` ke `fonts.googleapis.com` di `<head>`. Ini keputusan sadar: meng-embed font juga
membuat tiap halaman jadi ~25MB (total ~800MB) tanpa manfaat nyata, karena halaman ini
memang akan dihosting. Kalau suatu saat butuh benar-benar offline, ganti `<link>` itu
dengan `@font-face` yang menunjuk file font lokal.

## Yang diubah dari aslinya

Bukan salinan mentah. Yang dilakukan pada tiap halaman, semuanya tanpa efek visual:

- **Font teks → CDN.** Elementor menyimpan sendiri Google Fonts dalam **semua** subset
  unicode (cyrillic, greek, vietnamese) dan 4 format file. Yang dipakai halaman berbahasa
  Indonesia hanya subset latin, dan browser modern hanya memakai `woff2`. Diganti satu
  `<link>` Google Fonts. Font **ikon** (eicons, FontAwesome, ionicons) tetap tertanam —
  tidak tersedia di Google Fonts.
- **`@font-face` kembar dibuang.** Stylesheet theme/Elementor/plugin mendeklarasikan ulang
  font ikon yang sama, sampai satu font tertanam 14 kali.
- **Bundle tak terpakai dibuang** (~69 file per halaman): WooCommerce, bundle SPA booking
  KiviCare, `wp-emoji`, `comment-reply`. Tidak ada yang mempengaruhi tampilan landing page.
- **`srcset` dilepas.** `src` sudah jadi `data:` URI, jadi gambar tetap tampil; yang hilang
  hanya pemilihan resolusi per-viewport.
- **Admin bar WordPress dibuang.** Render dilakukan sebagai admin (supaya draft terbaca),
  dan WordPress ikut menempelkan admin bar beserta avatar gravatar admin. Sudah dimatikan.

Ukuran akhir **9,1–20MB per halaman, total 347MB** — dari ~56MB per halaman kalau semuanya
ditanam mentah-mentah.

## Catatan yang perlu diketahui

- **Tautan navigasi masih menunjuk ke `appointment.praktiqu.com`.** Header, footer, dan
  tombol di dalam halaman belum di-rewrite — sengaja, karena tujuan barunya belum ada.
  Cari-ganti `https://appointment.praktiqu.com` saat memasang di front-end baru.
- **Form dan booking tidak berfungsi.** `action` form dan endpoint AJAX-nya menunjuk ke
  WordPress lama. Ini arsip tampilan, bukan aplikasi yang jalan.
- **Beberapa aset memang sudah rusak di sumbernya.** Sejumlah halaman merujuk
  `praktiqu.inbeez.id` dan `www.praktiqu.com` — domain lama yang sudah mati, jadi
  font/gambar itu sudah tidak tampil di WordPress-nya sendiri sebelum ditarik ke sini.
  Bukan efek proses ini.
- **Isi teks demo sebagian masih lorem ipsum**, sesuai aslinya di WordPress.
- **Satu gambar di `psikolog-maya-harry.html` memang rusak**, dan sudah rusak sebelum
  ditarik: halaman itu merujuk thumbnail Elementor `Maya-hari-2-scaled-…-rbbw4ls80u21…jpg`
  yang membalas **404** di WordPress-nya sendiri — thumbnail-nya diregenerasi dengan hash
  berbeda (`…-qjjuphi61ime…jpg` ada di server), tapi HTML halamannya masih menunjuk yang
  lama. Sengaja tidak ditukar diam-diam supaya arsip ini tetap cermin apa adanya; kalau mau
  ditambal, ganti URL-nya ke berkas yang hash-nya baru. Ini satu-satunya aset eksternal
  yang tersisa di seluruh 29 file.

## Cara memproduksi ulang

Skripnya ada di [`tools/`](tools). Jalankan dari box yang punya WordPress-nya
(butuh akses berkas + PHP CLI), karena aset dibaca dari disk:

```bash
scp tools/render.php tools/inline.mjs tools/batch.sh tools/manifest.txt praktiqu@<box>:~/
ssh praktiqu@<box> 'chmod +x ~/batch.sh && nohup ~/batch.sh &'   # ~7 menit untuk 29 halaman
scp 'praktiqu@<box>:~/lp-out/*.html' landing-page/
```

Menambah halaman = menambah satu baris `<post_id> <nama-file>` di `manifest.txt`.
Alasan tiap keputusan teknis di dalam skrip dijelaskan di `MANIFEST.md`.
