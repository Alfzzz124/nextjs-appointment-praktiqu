> **Provenance.** Written by the Laravel front-end team and committed to
> `raakanaka/laravel-praktiqu` on 2026-08-31 (commit `8bfe1f1`), in reply to
> `docs/handover/2026-08-30-slot-availability-and-google-sync-frontend.md`. Copied
> here verbatim on 2026-09-11 so it lives somewhere this repo can see it — the
> original was only in their repository, and its six requests are all work on us.
>
> What has been done about it since is recorded in
> `docs/superpowers/specs/2026-08-28-google-calendar-sync-design.md`.

# Slot availability + Google Calendar sync — jawaban frontend

**Untuk:** tim API PraktiQU
**Dari:** frontend Laravel
**Tanggal:** 30 Agu 2026
**Menanggapi:** `2026-08-30-slot-availability-and-google-sync-frontend.md`

---

# Part A — sudah dikerjakan

Semua poin A ditindak. Ringkasnya di bawah, plus satu hal yang perlu kalian tahu:
perubahan A1 memecahkan sesuatu di sisi kami yang tidak terlihat dari sisi kalian.

## Yang berubah di frontend

| Poin | Tindakan |
|---|---|
| A1 slot lampau disaring | Empty state dibedakan + **satu bug dinding-keras diperbaiki**, lihat bawah |
| A2 selalu kirim `date` | Sudah begitu sejak awal. `BookingApi::fetchSlots()` mewajibkan argumen `$dateIso`, tidak ada jalur yang memanggilnya tanpa tanggal |
| A3 `serviceId` wajib | Sudah. Route menolak 422 sebelum menyentuh backend; ada tesnya sejak Agu |
| A4 durasi layanan menang | Tidak ada kode yang perlu berubah. Dua komentar yang menyalahkan kisi 60 menit dihapus — sudah tidak benar |
| A5 `nextAvailable` | Kami memetakannya tapi **tidak memakainya di UI mana pun**. Tidak ada workaround untuk dibuang |
| A6 `is_public` | Sudah tertangani lewat `svcUnavailable` — 404 `professional_not_found` diperlakukan sebagai kondisi permanen, bukan galat sesaat |

## A1 memecahkan pemulihan timeout kami

Ini bagian yang perlu kalian baca.

Kami punya `BookingController::mungkinTerlanjurMasuk()`. Fungsinya: ketika `POST
/public/appointments` timeout (gateway menyerah pada ~8 detik sementara backend
jalan terus), kami harus menebak apakah janji temunya **terlanjur tercatat**.
Cara menebaknya bukan tebakan — satu GET ke `/slots`:

- slot masih ditawarkan → tidak ada yang mengambilnya, aman mengulang
- slot sudah hilang → kemungkinan besar kami sendiri yang mengambilnya, **jangan** ulangi

Sejak A1, ada sebab ketiga yang membuat slot hilang: **waktunya lewat**.

Akibatnya pada jam praktik terakhir:

1. Pasien menekan Pesan pada slot terakhir hari itu
2. Gateway timeout
3. Kami cek `/slots` — slotnya hilang, karena jamnya baru saja lewat
4. Kami simpulkan janji temunya mungkin sudah masuk
5. Pasien diberi tahu: *"pemesanan Anda KEMUNGKINAN sudah masuk. Jangan mengulang
   pemesanan untuk jam yang sama — hubungi klinik"*

Tidak ada apa pun yang tercatat. Pasien kehilangan bookingnya, lalu dilarang
mencoba lagi, lalu disuruh menelepon klinik menanyakan janji temu yang tidak ada.

**Sudah kami perbaiki** (commit `49902a5`): slot yang hilang hanya dihitung sebagai
bukti kalau jam mulainya **belum** lewat. Tidak ada yang perlu kalian ubah untuk
ini — kami catat supaya kalian tahu bentuk konsekuensinya, karena pola yang sama
akan muncul lagi di Part B (lihat bawah).

## Satu hal yang kami pertahankan, sengaja

Saringan slot lampau di sisi klien **tidak kami buang** meski backend sudah
melakukannya. Bukan karena tidak percaya — karena yang ditegakkannya berbeda:
`minBookingNoticeMinutes` dari `/public/config`. Angka itu kalian kirim tapi tidak
kalian tegakkan di service layer. Tanpa saringan klien, pasien masih bisa memesan
jam yang secara teknis belum lewat tapi terlalu mepet untuk dihadiri.

Kalau suatu saat backend ikut menegakkan `minBookingNoticeMinutes`, beri tahu kami
dan saringan itu kami hapus.

## Catatan soal A2 yang mungkin berguna

Kalian menulis default `date` diturunkan di UTC dan itu masih defect terbuka.
Untuk referensi: kami menemukan bentuk bug yang persis sama di
`PublicProfessional.nextAvailable` (A5 kalian) **dan** di dashboard kami sendiri —
antara 00:00–07:00 WIB, konversi UTC atas tanggal lokal menghasilkan hari kemarin.
Tiga tempat, satu akar. Mungkin ada tempat keempat yang belum ketemu; kalau kalian
menambal `date`, `nextAvailable` saja mungkin belum cukup.

---

# Part B — Google Calendar sync

Tidak ada kode yang kami tulis, sesuai instruksi kalian. Ini umpan baliknya.

## B3 — bentuk endpoint: cocok

`/professionals/me/google-calendar` sejalan dengan pola scope kami. Tidak ada
keberatan.

Satu permintaan pada response status: **sertakan `connectedAt`**. Ketika seorang
psikolog melaporkan "sinkronisasinya aneh", pertanyaan pertama staf klinik selalu
"sejak kapan tersambung". `lastCheckedAt` tidak menjawab itu.

## B6 — konvensi redirect: kami ikut kalian

Repo ini belum punya konvensi redirect-result yang mapan, jadi tidak ada yang
perlu kalian cocoki. Usul kami, kalau kalian mau satu:

```
/dashboard/pengaturan/kalender?gcal=ok
/dashboard/pengaturan/kalender?gcal=denied
/dashboard/pengaturan/kalender?gcal=error
```

Satu parameter, nilai tertutup. Alasannya: parameter terpisah per hasil
(`?success=1` vs `?error=...`) membuat sisi kami harus memeriksa kombinasi yang
tidak mungkin terjadi, dan cepat atau lambat ada yang lupa satu cabang.

Kalau kalian butuh detail kegagalan, taruh di parameter kedua yang **opsional**
(`?gcal=error&reason=token_exchange_failed`) — jangan dimasukkan ke `gcal` itu
sendiri, supaya himpunan nilainya tetap kecil dan bisa dicocokkan `switch`.

## B4 — empat state: satu keberatan, satu penegasan

**Penegasan — `revoked` bukan error.** Poin kalian benar dan kami akan
memperlakukannya begitu. Pencabutan 7 harian selama app masih Testing berarti
setiap psikolog yang tersambung akan mendarat di `revoked` tiap minggu. Kalau kami
merendernya merah dengan ikon peringatan, kalian akan menerima laporan bug tiap
Senin selama berminggu-minggu. Akan kami buat sebagai ajakan tenang: "Hubungkan
ulang Google Calendar", tanpa warna bahaya.

**Keberatan — `error` tanpa `lastErrorMessage` tidak bisa ditampilkan.** Kalian
menulis `lastErrorMessage` bisa null pada state `error`. Kalau itu terjadi, satu-
satunya yang bisa kami tampilkan adalah "terjadi kesalahan" — kalimat yang tidak
memberi psikolog maupun staf klinik satu pun langkah berikutnya. Permintaan kami:
pada `status: "error"`, jadikan `lastErrorMessage` **wajib terisi**, dan isinya
kalimat yang bisa dibaca orang non-teknis. Kalau penyebabnya tidak bisa
diterjemahkan, kirim kode stabil yang bisa kami petakan sendiri ke kalimat
Indonesia — itu justru lebih kami suka.

## B5 — kalender bawaan Google: setuju, dan tolong di sisi kalian juga

Mengecualikan kalender hari libur & ulang tahun secara default: setuju, akan kami
lakukan di picker.

Tapi kami minta pengecualian yang sama **juga ada di backend**, bukan hanya di UI
kami. Alasannya: picker kami hanya melindungi psikolog yang memakai picker itu.
Kalau `calendarIds` bisa diisi lewat jalur lain — atau kalau default server-side
kalian memasukkan semua kalender — satu entri "ulang tahun Budi" menghapus seluruh
slot hari itu, dan psikolognya kehilangan pendapatan sehari penuh tanpa tahu
sebabnya. Perlindungan yang cuma ada di lapisan tampilan bukan perlindungan.

## B2 — satu pertanyaan yang belum terjawab

Alur OAuth kalian: browser dinavigasi keluar ke Google, lalu Google kembali ke
callback **kalian**, lalu kalian redirect ke halaman kami.

Pertanyaannya: **bagaimana kalian tahu halaman kami yang mana?** Kami punya lebih
dari satu tenant, dan URL settings-nya berbeda per tenant. Kalau redirect target
di-hardcode di sisi kalian, kami akan mendarat di tenant yang salah.

Opsi yang kami lihat: (a) kami kirim `returnUrl` saat meminta auth-url dan kalian
simpan di state OAuth, atau (b) kalian turunkan dari tenant si profesional. Kami
lebih suka (a) — tapi kalau (a), **wajib divalidasi terhadap allowlist** di sisi
kalian. Parameter redirect yang diterima mentah-mentah adalah open redirect, dan
ini aplikasi kesehatan.

## Satu risiko yang belum ada di dokumen kalian

Kalian sudah mencatat bahwa write path belum berkonsultasi ke Google busy times,
jadi memblokir slot di UI tidak mencegah booking lewat hold-and-confirm. Setuju,
itu memang harus ditutup.

Tambahan dari kami: ketika Part B jalan, **`mungkinTerlanjurMasuk()` di sisi kami
perlu ditinjau ulang lagi**. Sekarang ada dua sebab slot hilang (diambil orang,
waktunya lewat) dan kami sudah membedakannya. Google Calendar menambah sebab
ketiga: psikolognya baru saja memblokir jam itu di kalender pribadinya. Dari
`/slots`, ketiganya terlihat identik — dan yang ketiga, sama seperti yang kedua,
bukan bukti bahwa booking berhasil.

Kalau `/slots` bisa memberi tahu **mengapa** sebuah slot tidak tersedia — atau
kalau ada endpoint terpisah untuk "apakah janji temu ini ada", yang sebenarnya
lebih kami butuhkan — masalah ini hilang seluruhnya dan kami bisa membuang
seluruh heuristik tebak-menebak itu. Itu permintaan terbesar kami dari daftar ini.

---

## Ringkasan permintaan

Diurutkan dari yang paling berdampak:

1. **Endpoint "apakah janji temu ini ada"** — menghapus kebutuhan menebak setelah
   timeout, sekarang dan setelah Part B
2. **Pengecualian kalender holidays/birthdays di backend**, bukan hanya UI
3. **`lastErrorMessage` wajib saat `status: "error"`**
4. **Kejelasan redirect target multi-tenant** (B2) + allowlist kalau pakai `returnUrl`
5. `connectedAt` di response status
6. Kabari kalau `minBookingNoticeMinutes` mulai ditegakkan backend, supaya saringan
   klien kami dihapus
