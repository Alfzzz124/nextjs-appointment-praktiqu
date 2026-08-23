# Technical debt — 26 jam praktik `00:00:00–00:00:00` di `wp_kc_clinic_sessions`

**Ditemukan** 2026-08-23, saat memverifikasi fix pemetaan kolom TIME (`33d79e0`).
**Database** `praktiqu_wp580` (live WordPress `appointment.praktiqu.com`, dan juga DB yang
dipakai app di `staging2.praktiqu.com`).
**Severity: rendah.** Tidak ada jadwal yang hilang dan tidak ada hari yang jadi tak-bisa-dibooking
— lihat "Dampak". Ini kebersihan data + satu celah validasi, bukan insiden.

> Jangan campur dengan bug `"1970 18:"` yang sudah diperbaiki di `33d79e0`. Bug itu bikin
> **semua** 331 baris tampil rusak karena mapper-nya salah. Yang di dokumen ini beda: 26 baris
> yang datanya di DB memang kosong, jadi setelah fix pun akan tampil `00:00 – 00:00`.

## Angkanya

```
total  null_time  nol_semua  selesai_sebelum_mulai
331    0          26         26
```

`nol_semua` dan `selesai_sebelum_mulai` sama-sama 26 → tidak ada kasus jam kebalik yang lain;
ke-26 itu memang persis baris yang isinya nol.

## Punya siapa

| clinic_id | Klinik | doctor_id | Dokter | Baris rusak | Baris valid |
|---|---|---|---|---|---|
| 37 | Praktik Psikolog Eko Yanita H | 505 | Eko Yanita H, M.Psi, Psikolog | **21** | 42 |
| 41 | Praktik Psikolog Hira Yuki | 25 | Hira Yuki Molira | 2 | 13 |
| 6 | Praktik Psikolog Indri | 31 | Indriyani Virginia M.Psi., Psikolog | 2 | 10 |
| 31 | Praktik Psikolog Diana Krisfie Rachmah Nugraha | 306 | Diana Krisfie Rachmah Nugraha, M.Psi., Psikolog | 1 | 2 |

Id barisnya: `1147`, `1752`, `1754`, `1756`, `1758`, `1760`, `1762`, `1764`, `1766`, `1768`,
`1770`, `1772`, `1774`, `1776`, `1778`, `1780`, `1782`, `1784`, `1786`, `1788`, `1790`, `1792`,
`2359`, `2372`, `2419`, `2434`.

**21 dari 26 milik satu dokter (505), dan pola waktunya khas:** tiga ledakan pada
`2025-02-23` jam `21:06:32`, `21:07:52`, `21:08:52` — masing-masing tepat 7 baris (mon–sun)
dengan rantai `parent_id` ke baris pertama tiap ledakan (1752, 1766, 1780). Bentuknya seperti
fitur "terapkan ke semua hari" yang disimpan tiga kali berturut-turut dengan jam kosong —
kemungkinan besar orangnya mengira form-nya belum tersimpan lalu mengulang. Sisa 5 baris
adalah kejadian tunggal yang tersebar: `2024-10-23`, `2025-12-03` (×2), `2025-12-29`, `2026-01-02`.

## Dampak — kenapa severity-nya rendah

Tidak ada satu pun hari yang kehilangan jadwal. Query ini mencari hari yang **hanya** punya
baris rusak (artinya benar-benar tak bisa dibooking) dan hasilnya **kosong**:

```sql
SELECT cs.doctor_id, cs.day, COUNT(*) n_rusak,
       (SELECT COUNT(*) FROM wp_kc_clinic_sessions x
         WHERE x.doctor_id=cs.doctor_id AND x.day=cs.day
           AND NOT (x.start_time='00:00:00' AND x.end_time='00:00:00')) n_valid_hari_sama
FROM wp_kc_clinic_sessions cs
WHERE cs.start_time='00:00:00' AND cs.end_time='00:00:00'
GROUP BY cs.doctor_id, cs.day HAVING n_valid_hari_sama=0;
```

Keempat dokter punya jadwal valid di hari-hari yang sama, jadi ke-26 baris ini duplikat sampah,
bukan jadwal yang hilang. Generator slot menghitung `endMin - startMin`, jadi baris nol
menghasilkan nol slot — tidak menambah apa pun, tidak menghapus apa pun.

Yang tersisa: **kebingungan operasional.** Di UI staff baris ini tampil `00:00 – 00:00`, dan
dokter yang bersangkutan (terutama 505, dengan 21 baris) melihat daftar jadwalnya penuh entri
kosong. Itu juga yang sangat mungkin dilaporkan sebagai "beberapa jam praktik rusak".

## Asal-usulnya bukan dari API kita

Endpoint `/api/v1/doctor-sessions` lahir **2026-07-03** (`88c9169`). Baris rusak terbaru dibuat
**2026-01-02**, jadi seluruh 26 baris mendahului endpoint kita — semuanya datang dari
KiviCare (wp-admin / FE-nya sendiri), bukan dari tulisan kita.

**Tapi celahnya ada di sisi kita juga.** `doctorSessionCreateSchema` di
`src/services/billing/validation.ts:217` hanya memeriksa format:

```ts
startTime: z.string().regex(TIME_RE),
endTime:   z.string().regex(TIME_RE),
```

`'00:00:00'` lolos regex, dan tidak ada satu pun pemeriksaan bahwa `endTime > startTime`. Sama
untuk `doctorSessionUpdateSchema` (baris 225). Jadi API kita **bisa memproduksi sampah yang
identik** ke depannya, dan sekarang justru lebih mungkin terjadi karena FE Laravel sudah
memakai `POST /doctor-sessions` (`ResourceController.php:45`).

## Yang perlu dikerjakan

1. **Tutup celah validasinya** (milik kita, prioritas utama — mencegah tambah parah).
   Tolak `endTime <= startTime` di `doctorSessionCreateSchema` dan `doctorSessionUpdateSchema`
   lewat `.refine()`. Untuk update perlu hati-hati: kalau hanya salah satu field dikirim,
   pembanding harus diambil dari baris yang tersimpan, jadi pemeriksaannya di service, bukan
   di schema. Tambahkan test yang meng-assert 400.
2. **Bersihkan 26 baris itu** — hanya setelah dikonfirmasi ke pemilik praktiknya, karena ini
   data produksi milik psikolog nyata. Kandidat paling jelas: 21 baris dokter 505, yang jelas
   hasil submit berulang. `DELETE` dengan `WHERE id IN (...)` daftar eksplisit di atas, jangan
   pakai predikat `start_time='00:00:00'` (bisa menyapu baris baru yang muncul setelahnya).
   Backup dulu: `mysqldump ... wp_kc_clinic_sessions`.
3. **Cek apakah KiviCare masih memproduksi ini.** Baris terakhir 2026-01-02 — kalau sejak itu
   tidak ada yang baru, kemungkinan sudah berhenti sendiri dan cukup dibersihkan sekali.
   Jalankan ulang query hitungan di atas beberapa minggu lagi untuk memastikan.

## Cara cek ulang

Dari box staging (kredensial DB terbaca dari `~/appointment.praktiqu.com/wp-config.php`):

```sql
SELECT COUNT(*) total,
       SUM(start_time IS NULL OR end_time IS NULL) null_time,
       SUM(start_time='00:00:00' AND end_time='00:00:00') nol_semua,
       SUM(end_time <= start_time) selesai_sebelum_mulai
FROM wp_kc_clinic_sessions;
```
