# Harga layanan dalam dolar untuk klinik internasional

**Tanggal:** 2026-11-18
**Status:** disetujui bagian per bagian (user, 2026-11-18). Menunggu tinjauan spec tertulis.
**Membangun di atas:** `2026-10-06-international-clinic-payment-design.md`,
`2026-11-05-opsi-durasi-layanan-design.md`
**Cabang:** `feat/harga-layanan-dolar` (BE, rilis duluan) + cabang bernama sama di FE

## Masalah

Pembayaran internasional sudah jalan: klinik yang ditandai `international` menerima PayPal dan
kartu, dan halaman booking menampilkan USD sejak render pertama. Tapi pengguna mengeluh fiturnya
**"masih rasa IDR banget"**, dan keluhan itu benar.

Harga hidup sebagai rupiah di `wp_kc_services.price` dan `wp_kc_service_doctor_mapping.charges`.
USD tidak pernah disimpan — ia dihitung ulang tiap kali dibutuhkan oleh
`buildUsdQuote()`: `cents = ceil(idr × (100 + markup) / kurs)`, ditambah satu baris biaya tetap.
Akibatnya:

- **Admin mengetik rupiah.** Form tambah/ubah layanan berlabel "Harga (Rp)" dengan `step="1000"`
  (`dashboard.blade.php:3957`). Admin klinik internasional harus menghitung mundur di kepala
  untuk mendapat angka dolar yang masuk akal.
- **Angkanya tidak pernah bulat.** Rp 425.000 dengan kurs 16.500 dan markup 10% menjadi $28,34.
  Tidak ada kombinasi rupiah yang membuat klien melihat $30,00 secara andal.
- **Angkanya bergerak sendiri.** Mengubah kurs klinik menggeser harga setiap layanan. Admin
  tidak pernah menetapkan satu harga dolar pun.
- **Hanya halaman booking yang berdolar.** Daftar layanan, tagihan, statistik pendapatan, dan
  dropdown booking manual semuanya rupiah — semuanya lewat satu pembantu `rupiah()` di
  `dashboard.blade.php:81`.

## Keputusan (dibuat user saat brainstorming, 2026-11-18)

| # | Pertanyaan | Keputusan |
|---|---|---|
| 1 | Patokan harga | **USD jadi patokan.** Harga dolar disimpan per layanan; rupiah diturunkan darinya. $55 tetap $55,00 walau kurs bergerak |
| 2 | Arti angka yang diketik | **Total akhir yang dibayar klien.** Markup tidak dipakai dan biaya tetap tidak ditambahkan untuk layanan ber-harga-dolar |
| 3 | Sisi rupiah | **Diturunkan dari dolar pakai kurs klinik.** Nilai tersimpan di KiviCare ikut diperbarui agar tagihan, Xendit, dan laporan tidak salah |
| 4 | Luas perubahan | **Semua layar uang.** Form layanan, daftar layanan, tagihan, statistik pendapatan, dropdown booking manual |

Bawaan yang diterima tanpa keberatan:

- **USD saja.** Mata uang lain proyek terpisah, sama seperti di spec 2026-10-06.
- **Markup dan biaya tetap tidak dihapus.** Keduanya masih dipakai layanan yang harganya masih
  rupiah, termasuk di klinik internasional yang belum dikonversi.
- **Tidak ada migrasi data.** Layanan lama tetap di jalur lama sampai admin menyimpannya.
- **Widget booking KiviCare sendiri di luar lingkup**, seperti sebelumnya.

## 1. Penyimpanan

### Kunci

Harga dolar satu layanan disimpan di `wp_kc_service_doctor_mapping.extra` (LONGTEXT), kunci
**`praktiqu_price_usd`**, bernilai **string 2 desimal**:

```json
{ "praktiqu_price_usd": "55.00" }
```

**Kenapa kolom ini.** Presedennya sudah ada: Opsi durasi menyimpan `praktiqu_duration_of` di
kolom yang sama (`src/repositories/wp/duration-option-marker.ts`). KiviCare mendeklarasikan
kolom itu tapi tidak pernah menulisinya — core, Pro, add-on telemed dan Meet, serta
`praktiqu-endpoint` semuanya sudah diperiksa pada 2026-11-05. Tidak ada DDL, tidak ada tabel
baru, dan harga dolarnya menempel pada baris yang memang sudah memegang harga dan durasi yang
berlaku — termasuk tiap baris opsi durasi, yang karena itu otomatis mendapat harga dolarnya
sendiri.

**Kenapa string, bukan number.** `55.10` sebagai JSON number kembali sebagai `55.1`, dan
membandingkan atau menjumlahkannya sebagai float membuka pintu yang persis ditutup spec
2026-10-06 dengan `Prisma.Decimal`. Yang disimpan selalu hasil `Decimal.toFixed(2)`.

**Dua kandidat yang ditolak:**

- *Tabel Prisma baru.* Memecah sumber kebenaran harga ke dua basis data, dan baris pemetaan
  yang dihapus meninggalkan baris harga yatim.
- *`wp_options` per klinik.* Satu baris JSON berisi semua layanan: dua admin yang menyimpan
  bersamaan saling menimpa. Ini persis alasan setelan pembayaran dipecah per klinik (spec
  2026-10-06 §1).

### Modul baca/tulis

`src/repositories/wp/usd-price-marker.ts`, sejajar dengan `duration-option-marker.ts`:

```ts
export const USD_PRICE_KEY = 'praktiqu_price_usd';

/** Harga dolar pada baris ini, atau null. Tidak pernah melempar. */
export function readUsdPrice(extra: string | null | undefined): Prisma.Decimal | null;

/** `extra` baru dengan harga dolar disetel atau dibuang; kunci lain dipertahankan utuh. */
export function writeUsdPrice(extra: string | null | undefined, usd: Prisma.Decimal | null): string;
```

- `readUsdPrice` mengembalikan `null` untuk JSON yang tidak terbaca, nilai bukan string, format
  yang tidak cocok `/^\d+(\.\d{1,2})?$/`, atau angka di luar 0,00–100.000,00. Isi yang tidak sah
  dibaca sebagai **"tidak ada harga dolar"**, bukan sebagai galat — satu baris rusak tidak boleh
  menjatuhkan daftar layanan.
- `writeUsdPrice` **wajib baca-gabung-tulis.** `extra` sudah berisi milik orang lain:
  `praktiqu_duration_of` dari fitur opsi durasi, dan JSON `product_id` warisan yang terverifikasi
  ada di produksi (gate 2026-11-07). Menimpa kolom ini akan memutus opsi durasi.
- `extra` yang bukan objek JSON diganti dengan objek baru berisi satu kunci. Isi yang tidak
  terbaca memang sudah tidak berarti apa-apa bagi siapa pun.

### Rupiah turunan

Saat harga dolar disimpan:

```
idr = Decimal(usd).mul(kurs).toDecimalPlaces(0, ROUND_HALF_UP).toNumber()
```

- **Kursnya kurs efektif klinik** dari `resolveSettings()` — nilai klinik kalau ada, kalau tidak
  nilai global. **Markup tidak ikut**: markup adalah bantalan konversi, dan di sini tidak ada
  yang dikonversi.
- `ROUND_HALF_UP`, bukan `ceil`. Dan karena rupiahnya selalu diturunkan ulang dari USD — tidak
  pernah dari rupiah sebelumnya — tidak ada efek merayap naik berapa kali pun disimpan.
- Ditulis ke `charges`. Pada **create** juga ke `wp_kc_services.price`, seperti alur yang ada.
  Pada **update** hanya `charges`: menulis master `price` diam-diam mengubah harga daftar yang
  dilihat klinik lain, dan itu keputusan yang sudah diambil sebelumnya
  (`src/services/service-catalog/service.ts:322`).
- **Tanpa kurs yang bisa dipakai, harga dolar tidak boleh disimpan.** Klinik yang `international`
  tapi jatuh ke aturan 3 spec 2026-10-06 (tidak ada kurs yang sah) menolak simpan dengan
  422 `fx_rate_required`.

### Stempel ulang saat kurs berubah

`PUT /api/v1/practices/{id}/payment-settings` yang mengubah kurs efektif klinik harus menulis
ulang `charges` **setiap** layanan ber-harga-dolar klinik itu. Kalau tidak, rupiah di KiviCare —
yang dibaca tagihan, Xendit, dan laporan — menjadi basi diam-diam.

Ini dijalankan **inline tapi terbatas**, bukan sebagai job. Job Action Scheduler baru akan
menuntut perubahan plugin: tiap hook harus lolos allow-list di
`class-praktiqu-endpoint-jobs.php:92`, punya `add_action`, dan punya handler webhook. Itu
membatalkan janji "plugin tidak tersentuh" di §6 hanya demi pekerjaan kosmetik.

Caranya satu pernyataan, bukan ratusan:

```sql
UPDATE wp_kc_service_doctor_mapping
   SET charges = CASE id WHEN ? THEN ? WHEN ? THEN ? ... END
 WHERE id IN (?, ?, ...)
```

dipecah per 200 baris di dalam satu transaksi. Klinik dengan 500 layanan berarti tiga
pernyataan, bukan 500 — penting karena `max_user_connections` di sana adalah 5.

Kegagalan stempel ulang **tidak** membatalkan penyimpanan setelan dan tidak mengembalikan galat
ke admin: harga dolarnya sudah benar dan alur kami sudah tidak membaca `charges`, jadi yang
tertinggal cuma cermin untuk layar KiviCare. Kegagalannya dicatat sebagai `warn` dengan daftar
id yang gagal.

## 2. Aturan tagih

### Definisi

- **Baris ber-harga-dolar** — satu baris pemetaan yang `readUsdPrice(extra)`-nya bukan `null`.
- **Order dolar penuh** — klinik `international`, punya kurs yang bisa dipakai, dan **setiap**
  baris item dalam order itu ber-harga-dolar.

Order campuran hanya mungkin di tagihan staf, tidak pernah di booking publik. Aturannya tegas:
**satu baris saja tanpa harga dolar, seluruh order kembali ke jalur lama.** Tidak ada
setengah-setengah — menggabungkan satu baris berharga tetap dengan satu baris yang kena markup
menghasilkan total yang tidak bisa dijelaskan ke siapa pun.

### Untuk order dolar penuh

| | Jalur lama | Jalur dolar |
|---|---|---|
| Baris item | `ceil(idr × (100 + markup) / kurs)` | `priceUsd` apa adanya |
| Markup persen | dikali ke tiap baris | **tidak dipakai** |
| Biaya tetap | baris "International service fee" | **tidak ditambahkan** |
| Baris pajak | dikonversi dan ditambahkan | **tidak ditambahkan** |
| `totalUsd` | jumlah hasil konversi | **jumlah `priceUsd`, persis** |

`buildUsdQuote()` mendapat cabang baru di depan, bukan tulisan ulang. Tanda tangannya menerima
`priceUsd` opsional per item; kalau semua item punya, jalur dolar; kalau tidak, kode yang ada
sekarang berjalan tanpa berubah satu baris pun.

**`charges` tidak pernah jadi sumber kebenaran untuk alur kami.** Setiap kali order dibangun,
rupiah baris ber-harga-dolar diturunkan **ulang** dari `priceUsd × kurs efektif saat itu` —
untuk ditampilkan maupun untuk ditagih lewat Xendit. `charges` hanyalah cermin yang dipakai
layar KiviCare sendiri. Dengan begitu jeda antara kurs berubah dan job stempel ulang selesai
tidak pernah bisa menagih atau mencatat angka yang salah; jeda itu paling buruk hanya membuat
layar KiviCare tertinggal sebentar.

**`expectedIdr`** untuk order dolar penuh adalah jumlah rupiah turunan baris-barisnya, **tanpa
pajak**. Pajak diperlakukan sudah termasuk di kedua sisi: menambahkannya ke `expectedIdr` saja
akan membuat pencairan menagih rupiah lebih besar daripada yang ditutup dolarnya.

**`effectiveFxRate`** yang dicatat di `payment_orders` adalah kurs klinik apa adanya, tanpa
markup — karena memang itu yang dipakai menurunkan rupiahnya.

**`snapshot`** mendapat satu ruas baru, `pricing: 'usd_direct' | 'converted'`, supaya riwayat
order bisa dibaca bertahun kemudian tanpa menebak.

**Order gratis.** `priceUsd` `"0.00"` sah dan berarti gratis, persis seperti Rp 0. Order yang
seluruh barisnya nol tetap lewat jalur gratis yang ada dan tidak pernah ditagih.

**Backstop skew versi tetap.** Perbandingan `chargedAmount` dengan `quote.totalUsd` dalam sen
bulat, beserta auto-cancel dan 502 `charge_mismatch`, tidak berubah.

### Batasan yang diterima

Klien yang membayar lewat Xendit membayar rupiah turunannya **ditambah** pajak yang
terkonfigurasi, sementara klien dolar membayar harga yang sudah dianggap termasuk pajak. Di
produksi tabel pajak klinik-klinik ini kosong (diverifikasi pada gate 2026-11-07), jadi hari ini
keduanya identik. Kalau pajak nanti diisi, selisih itu muncul. Melipat pajak ke dalam harga di
kedua sisi adalah pekerjaan terpisah, bukan bagian rilis ini.

Klinik yang selama ini mengandalkan biaya tetap "International service fee" kehilangan
pendapatan itu pada layanan yang dikonversi, dan harus menaikkan harga dolarnya sendiri. Ini
konsekuensi langsung dari keputusan 2 dan sudah diterima.

## 3. Kontrak API

Prinsip yang dipegang halaman setelan pembayaran dipertahankan: *"Halaman ini TIDAK menghitung
kurs… salinan rumusnya di sini hanya akan menjadi angka ketiga yang bisa berbeda."* FE tidak
pernah mengalikan apa pun dengan kurs.

### Blok `currency`

Tiap respons yang membawa uang untuk satu klinik membawa:

```json
"currency": { "code": "USD", "fxRate": "16500" }
```

`code` adalah `"IDR"` untuk klinik non-internasional dan untuk klinik internasional tanpa kurs
yang bisa dipakai; `fxRate` `null` dalam kasus itu. FE memformat berdasarkan `code` saja.

**Blok ini ikut di respons `/services`, bukan menyuruh FE memanggil payment-settings.** Psikolog
boleh menyunting harga layanannya sendiri sejak 2026-10-15, tapi `GET
/api/v1/practices/{id}/payment-settings` hanya untuk SUPER_ADMIN dan CLINIC_ADMIN. Kalau FE
harus memanggil endpoint itu, form psikolog di klinik internasional kosong mata uangnya.

### Endpoint

| Endpoint | Perubahan |
|---|---|
| `GET /api/v1/services`, `GET /api/v1/services/{id}` | `priceUsd: string \| null` dan `priceUsdSuggested: string \| null` (§5) per layanan dan per opsi durasi, **di samping** `price` rupiah yang tetap ada; plus blok `currency` |
| `POST /api/v1/services` | menerima `priceUsd` sebagai alternatif `price` |
| `PUT /api/v1/services/{id}` | sama; juga pada tiap entri `durationOptions` |
| `PUT /api/v1/practices/{id}/payment-settings` | menstempel ulang `charges` klinik itu saat kurs efektif berubah (§1) |
| `GET /api/v1/bills` | blok `currency` saja — lihat di bawah |
| `GET /api/v1/dashboard/statistics`, `/revenue-chart`, `/recent-payments`, `/top-professionals` | sama |

**Layar uang hanya mendapat kursnya, bukan angka dolarnya** (keputusan user, 2026-11-19).

Rencana awal memberi pasangan `*Usd` untuk setiap angka rupiah di lima endpoint itu. Yang
dipakai lebih sempit: endpoint-endpoint itu membawa blok `currency`, dan pembantu `uang()`
di FE yang memformat.

Alasannya: prinsip "FE tidak menghitung kurs" ada untuk melindungi angka yang **ditagih**,
dan tidak satu pun angka di layar-layar itu adalah angka yang ditagih. Harga layanan — yang
betul-betul ditagih — tetap dihitung backend dan dikirim sebagai `priceUsd`. Pendapatan
bulan lalu yang dikonversi dengan kurs hari ini memang perkiraan, dan ditandai `≈`.

Blok itu ditaruh **di dalam `data`**, bukan sejajar dengannya. `PraktiquApi::unwrap()` di
Laravel FE membuang segala sesuatu selain `data` begitu amplopnya punya `status` atau
`message`, jadi ruas di tingkat amplop tidak akan pernah sampai ke halaman.

Karena itu hanya endpoint yang payload-nya objek yang membawanya: `statistics` dan `bills`.
Grafik pendapatan, pembayaran terakhir, dan psikolog teratas mengirim larik — menyelipkan
ruas ke sana akan mengubah bentuknya dan memutus klien yang sudah ada. Halaman toh hanya
butuh SATU mata uang, dan mengambilnya dari `statistics` (atau `bills` kalau statistiknya
disembunyikan karena kebocoran cakupan).

Mata uangnya dibaca dari klinik yang sedang dilihat pengguna (`KcActor.clinicId`). Tanpa
satu klinik — SUPER_ADMIN yang melihat semuanya — jawabannya rupiah: angka lintas-klinik
tidak punya satu kurs yang benar.

### Validasi `priceUsd`

- String yang cocok `/^\d+(\.\d{1,2})?$/`, dinormalkan ke 2 desimal. Angka JSON ditolak.
- 0,00 sampai 100.000,00.
- `price` dan `priceUsd` dikirim bersamaan → 422 `price_conflict`. Hanya satu yang boleh.
- `priceUsd` ke klinik non-internasional → 422 `usd_price_not_allowed`.
- `priceUsd` ke klinik internasional tanpa kurs → 422 `fx_rate_required`.
- `price` rupiah ke layanan yang sudah ber-harga-dolar **membuang** harga dolarnya dan
  mengembalikan baris itu ke jalur lama. Ini jalan sadar untuk membatalkan konversi.

Pemeriksaan desimal memakai `hasAtMostTwoDecimals()` yang sudah diekspor
`src/services/payments/intl-pricing.ts` — bukan salinan baru.

## 4. Perubahan per layar (Laravel FE)

### Pembantu bersama

`rupiah(n)` di `dashboard.blade.php:81` diganti `uang(n, kode)`. Klinik rupiah lewat jalur yang
sama dan keluar rupiah, jadi tidak ada cabang kedua yang bisa membusuk diam-diam tanpa ada yang
melihat. `kode` diambil dari blok `currency` yang dipasang sekali per permintaan dashboard.

### Daftar layar

| Layar | Sekarang | Jadi |
|---|---|---|
| Form tambah/ubah layanan (`dashboard.blade.php:3957`) | `Harga (Rp)`, `step="1000"` | `Harga (USD)`, `step="0.01"`, `min="0"`, awalan `$`; di bawahnya "Klien membayar **$55.00** · ≈ Rp 907.500" |
| Kartu layanan (`:3730`) | `Rp425.000` | `$55.00` besar, `≈ Rp 907.500` kecil |
| Dropdown booking manual (`:5653`) | `'Rp' + s.price` | `$55.00` |
| Tabel Billing (`mapBill`, `self::rp`/`self::money`) | rupiah | `≈ $…`, dikonversi FE dari blok `currency` |
| Statistik pendapatan + 4 tabel laporan (`rupiah()` di `:1210`, `:4471`, `:4499`, `:4518`, `:4551`) | rupiah | `≈ $…`, sama |
| Setelan pembayaran klinik (`klinik-pembayaran.blade.php`) | markup & biaya tetap polos | diberi label "berlaku untuk layanan yang harganya masih rupiah" |
| Halaman booking publik (`booking.blade.php`) | sudah USD | tidak berubah; totalnya kini persis |

Pratinjau rupiah di bawah isian form datang dari respons simpan, bukan dihitung di browser.
Sebelum disimpan pratinjaunya kosong, bukan menebak.

### Statistik historis adalah perkiraan

Pendapatan bulan lalu yang dikonversi dengan kurs **hari ini** bukan angka yang benar-benar
ditagih. Angka asli ada di `payment_orders.chargedAmount` + `chargedCurrency` untuk order kartu
dan PayPal yang sudah dibayar. Rilis ini menampilkan `≈` dengan satu catatan kurs di bawah
kartu statistik dan menerima bahwa itu perkiraan. Menjumlahkan dari `payment_orders` adalah
pekerjaan terpisah, dikerjakan kalau pengguna menuntutnya.

## 5. Klinik yang sudah ada

Klinik 44 (Pamela) dan 43 (Azani) sudah `international` dengan layanan berharga rupiah.

**Tidak ada migrasi data dan tidak ada skrip.** Tanpa `praktiqu_price_usd` setiap layanan tetap
di jalur lama — persis seperti hari ini, tidak satu harga pun berubah saat deploy.

Yang berubah hanya formnya. Begitu dibuka untuk klinik internasional, isiannya berlabel USD dan
sudah terisi hasil konversi harga rupiah yang berlaku sekarang (Rp 425.000 pada kurs 16.500
dengan markup 10% → `28.34`). Admin membulatkannya jadi `30.00`, menyimpan, dan baris itu pindah
ke jalur dolar. Pembulatannya keputusan admin per layanan, bukan skrip yang menebak angka bulat.

Nilai awal itu dihitung backend dan dikirim sebagai `priceUsdSuggested`, pada daftar maupun
detail layanan, terpisah dari `priceUsd` yang `null` — supaya FE tidak pernah salah mengira
layanan itu sudah dikonversi. Form Ubah di FE terisi dari baris daftar (`r.rawPrice` hari ini),
jadi ruas ini wajib ada di `GET /api/v1/services`, bukan hanya di detail.

## 6. Urutan rilis

**Plugin tidak tersentuh sama sekali.** Semuanya ada di `extra` yang dibaca Next.js, dan
`charges` tetap diisi seperti biasa, jadi `praktiqu-endpoint` dan KiviCare tidak tahu ada yang
berubah.

1. **BE** (`feat/harga-layanan-dolar`) — penyimpanan, aturan tagih, kontrak API, job stempel
   ulang.
2. **FE** (cabang bernama sama) — pembantu `uang()`, form, dan layar-layarnya.

Tidak ada celah deploy: FE lama mengabaikan blok `currency` yang tidak dikenalnya dan tetap
mengirim `price` rupiah, yang tetap sah.

Setelah merge, **periksa build Hostinger-nya**. Auto-deploy pernah melewati tiga merge berturut
(2026-10-20), dan `LIMIT_BUILD_WORKERS=1` wajib ada di hPanel.

## 7. Risiko dan pengujian

Diurut dari yang paling bisa menggigit:

1. **`extra` berisi milik orang lain.** `praktiqu_duration_of` dan JSON `product_id` warisan.
   *Uji:* menulis harga dolar pada baris yang punya penanda opsi durasi, lalu membaca penanda itu
   kembali utuh; dan sebaliknya.
2. **Vektor emas jalur lama bergeser.** Lima vektor di spec 2026-10-06 §2 wajib tetap hijau
   setelah `buildUsdQuote()` disentuh. *Uji:* tabel vektor yang ada dipertahankan apa adanya,
   plus tabel baru untuk jalur dolar.
3. **Stempel ulang membanjiri koneksi.** `max_user_connections` adalah 5. *Uji:* 450 layanan
   ber-harga-dolar menghasilkan 3 pernyataan UPDATE, bukan 450.
4. **Order campuran diam-diam setengah dikonversi.** *Uji:* tagihan staf dengan satu baris
   ber-harga-dolar dan satu tanpa → seluruh order memakai jalur lama.
5. **Stempel ulang menyentuh yang bukan haknya.** Tagihan yang sudah terbit menyimpan angkanya
   sendiri dan tidak boleh ikut ditulis ulang; hanya baris katalog yang disentuh. *Uji:* tagihan
   yang sudah ada tidak berubah setelah kurs diganti.
6. **Pembulatan.** *Uji:* $55,00 pada kurs 16.500 → Rp 907.500, dan menyimpan sepuluh kali
   berturut-turut tetap Rp 907.500.
7. **Psikolog di klinik internasional.** *Uji:* `GET /api/v1/services` sebagai psikolog
   mengembalikan blok `currency` berkode USD tanpa menyentuh payment-settings.

Blok id uji memakai registri `idBlock()` yang sudah ada.

## Di luar lingkup

- Mata uang selain USD.
- Tombol "bulatkan semua ke dolar" di halaman setelan.
- Widget booking KiviCare sendiri, yang gateway PayPal bawaannya mengirim rupiah tanpa konversi.
- Angka pendapatan historis yang akurat dari `payment_orders`.
- Melipat pajak ke dalam harga di sisi rupiah.
