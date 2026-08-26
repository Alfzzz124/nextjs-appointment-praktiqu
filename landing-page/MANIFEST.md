# Manifest — asal tiap file

Ditarik 2026-08-23 dari `appointment.praktiqu.com` (DB `praktiqu_wp580`), tabel `wp_posts`.
Kolom **Status** adalah status di WordPress saat ditarik; draft ikut ditarik dan hasilnya
sama utuh dengan yang publish.

## Template demo (8)

| File | ID | Slug asal | Judul di WordPress | Status |
|---|---|---|---|---|
| `demo-1-hijau.html` | 38904 | `professional-page-1` | Professional Page Demo Final 1 - #36A592 HIJAU | publish |
| `demo-3.html` | 39352 | `professional-page-3` | Professional Page Demo Final 3 | publish |
| `demo-4.html` | 39422 | `professional-page-4` | Professional Page Demo Final 4 | publish |
| `demo-5.html` | 39428 | `professional-page-5` | Professional Page Demo Final 5 | publish |
| `demo-6-black.html` | 39433 | `professional-page-6` | Professional Page Demo Final 6 - BLACK | draft |
| `demo-7.html` | 39438 | `professional-page-7` | Professional Page Demo Final 7 | draft |
| `demo-3-green.html` | 40017 | `page-demo-final-3-green` | Page Demo Final 3 Green | draft |
| `demo-6-hira-yuki.html` | 40677 | `professional-page-demo-final-6-hira-yuki` | Professional Page Demo Final 6 - Hira Yuki | draft |

Tidak ada "Demo Final 2" di WordPress — penomorannya melompat dari 1 ke 3.

## Landing page psikolog (21)

| File | ID | Slug asal | Judul di WordPress | Status |
|---|---|---|---|---|
| `psikolog-hira-yuki-molira.html` | 40787 | `psikolog-hira-yuki-molira` | Profesional page hira yuki molira | publish |
| `psikolog-mutiara-pertiwi.html` | 40996 | `psikolog-mutiara-pertiwi` | Profesional Page Mutiara Pertiwi | publish |
| `psikolog-maya-harry.html` | 41594 | `psikolog-maya-harry` | Profesional Page Psikolog Maya Harry | publish |
| `psikolog-roellya-a-tyas.html` | 42358 | `profesional-psikolog-roellya-a-tyas` | Profesional Page Roellya A Tyas | publish |
| `psikolog-agitya-putri.html` | 42390 | `psikolog-agitya-putri` | Profesional Page Agitya Yanifa Putri, M. Psi., Psikolog | publish |
| `terapis-siti-maulany.html` | 43200 | `terapis-siti-maulany-s-psi` | Profesional page Siti Maulany, s.Psi | publish |
| `psikolog-indriyani-virginia.html` | 45484 | `psikolog-indriyani-virginia` | Profesional Page Indriyani Virginia, M. Psi., Psikolog | publish |
| `psikolog-surayya-sakinah.html` | 47359 | `psikolog-surayya-sakinah` | Profesional Page Surayya Sakinah, S.Psi, M.Psi, Psikolog | publish |
| `psikolog-dianda-azani.html` | 39587 | `psikolog-dianda-azani` | Professional Page - Psikolog - Dianda Azani | publish |
| `psikolog-pamela-anggia-dewi.html` | 42255 | `psikolog-pamela-anggia-dewi` | Professional Page Pamela Anggia Dewi | publish |
| `psikolog-fridya-mayasari.html` | 43850 | `psikolog-fridya-mayasari` | Professional Page Fridya Mayasari, S.Psi, Psikolog, EPC | publish |
| `psikolog-catur-wahyuti.html` | 44891 | `psikolog-catur-wahyuti` | Professional Page Catur Wahyuti, S.Psi., M.Psi., Psikolog | publish |
| `psikolog-fauzia-wati.html` | 46458 | `psikolog-fauzia-wati` | Professional Page Fauzia Wati, S.Psi., M.Psi., Psikolog | publish |
| `psikolog-eko-yanita.html` | 46771 | `psikolog-eko-yanita` | Professional Page Eko Yanita H, M.Psi, Psikolog | publish |
| `psikolog-andi-zainuddin.html` | 47299 | `psikolog-andi-zainuddin` | Profesioonal Page Andi Zainuddin Japeri, M. Psi, Psikolog | publish |
| `psikolog-medwin-wisnu-prabowo.html` | 40424 | `psikolog-medwin-wisnu-prabowo` | Profesional Page Medwin Wisnu Prabowo | draft |
| `psikolog-dimas-danang.html` | 41313 | `psikolog-dimas-danang` | Profesional Page Psikolog Dimas Danang S.Psi., M.Psi., Psikolog, CH., CHt. | draft |
| `psikolog-dzakiyyah-nur-afifah.html` | 44588 | `psikolog-dzakiyyah-nur-afifah` | Profesional Page Dzakiyyah Nur Afifah, M.Psi., Psikolog | draft |
| `psikolog-diana-krisfie.html` | 45916 | `psikolog-diana-krisfie` | Profesional Page Diana Krisfie Rahma Nugraha, M.Psi., Psikolog | draft |
| `psikolog-mutiara-sadjad.html` | 46583 | `psikolog-mutiara-sadjad` | Professional Page Mutiara Sadjad, S.Psi, M,Psi, Psikolog | draft |
| `psikolog-winda-ruliana.html` | 41048 | `psikolog-winda-ruliana` | Profesional Psikolog winda-ruliana | draft |

## Cara menemukannya — dan kenapa tidak cukup satu kata kunci

Kata kunci `"Profesional Page Demo"` **tidak cocok dengan satu halaman pun**. Penamaan di
WordPress tidak konsisten, jadi pencariannya harus dilebarkan:

- `Profesional Page ...` — ejaan Indonesia, 12 halaman
- `Professional Page ...` — ejaan Inggris, dan semua template demo memakai ini
- `Profesioonal Page ...` — salah ketik, 1 halaman (Andi Zainuddin) yang lolos dari kedua pola di atas
- `Profesional Psikolog ...` — pola berbeda lagi, 1 halaman (winda-ruliana)

Query yang akhirnya dipakai memasang jaring `post_title LIKE '%rofesional%' OR '%rofessional%'
OR '%sikolog%'` pada `post_type='page'`, lalu disaring manual. Sebagai jaring pengaman,
semua halaman dengan `post_content` > 6000 byte yang **tidak** cocok pola apa pun juga
diperiksa — hasilnya cuma halaman demo bawaan tema KiviCare (Cardiac, Dentist, Shop, dsb),
bukan landing page Praktiqu.

## Yang sengaja TIDAK ditarik

| Kelompok | Jumlah | Alasan |
|---|---|---|
| `Appointment <nama>` | ~24 | Isinya 51–124 byte — hanya shortcode booking KiviCare, bukan desain halaman |
| `Our Professional` / `Our Profesional` / `Versi CPT` | 4 | Halaman daftar/direktori, bukan landing page satu profesional |
| `Professional Page 2` (×2), `Professional Page 3`, `Version 1.2 Profesional` | 4 | Iterasi desain awal; bisa ditarik kalau memang dibutuhkan |
| `Professional Page delete` (ID 40708) | 1 | Judulnya sendiri menandai halaman ini untuk dihapus |
| `Archive Psikolog`, `Cari Psikolog`, `Tes Psikologi` | 3 | Halaman utilitas |

## Cara memproduksi ulang

Dua skrip, dijalankan dari box staging (`praktiqu@101.50.1.106`, port 45022):

1. **`~/render.php <post_id>`** — render satu halaman lewat PHP CLI, keluarkan HTML ke stdout.

   Ini di-render dari CLI, bukan diambil lewat HTTP, karena **9 dari 29 halaman berstatus
   draft dan draft membalas 404 lewat HTTP**. Skrip ini memasang tiga hook sebelum WordPress
   boot (lewat `$GLOBALS['wp_filter']`, satu-satunya cara memasang hook sebelum
   `add_action()` ada): `wp_set_current_user(1)` supaya draft lolos pemeriksaan kapabilitas,
   `redirect_canonical` → false karena halaman publish yang diminta lewat `?page_id=` akan
   di-redirect dan body-nya kosong, dan `show_admin_bar` → false karena login sebagai admin
   membuat WordPress menempelkan admin bar beserta avatar gravatar admin ke tiap halaman.
   Tidak ada satu pun operasi tulis — semua perubahan hanya di memori proses itu.

2. **`~/inline.mjs <in.html> <out.html>`** — satukan semua aset jadi satu file.

   Aset di bawah `wp-content/` dibaca dari disk (lebih cepat, dan tidak kena WAF); sisanya
   lewat HTTP. Semua penyisipan isi aset memakai **fungsi** pengganti pada `String.replace()`,
   bukan string — kalau memakai string, `$&` di dalam JS ter-minify ditafsirkan sebagai
   "teks yang cocok" dan menyuntikkan tag `<script>` ke tengah kode, merusak JS-nya secara
   senyap.

`~/batch.sh` menjalankan keduanya berurutan untuk seluruh isi `~/manifest.txt`. Sengaja
sekuensial, bukan paralel: ini box produksi milik bersama.
