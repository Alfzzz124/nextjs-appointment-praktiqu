# Menyiapkan 3 akun tester — langkah manual

Disusun 2026-07-31 dari keadaan nyata kedua database, bukan asumsi.

## Yang perlu dipahami dulu (ini menentukan semua langkah di bawah)

staging2 memakai **dua sumber yang berbeda**:

| | Sumber | Menentukan |
|---|---|---|
| **Password & role** | `appointment.praktiqu.com` → **wp580 (PRODUKSI)** | apakah bisa login, dan jadi role apa |
| **Data** | **wp314 (staging)** | apa yang muncul di daftar klien, sesi, dsb |

Konsekuensi yang tidak boleh dilupakan:

- **Reset password harus di produksi.** Password di wp314 tidak pernah dibaca siapa pun.
- **Role di JWT diambil dari produksi.** Mengubah `wp_capabilities` di wp314 tidak akan
  mengubah role saat login. Kode: `derivePraktiQURole(wp.roles)` di
  `src/lib/auth/wp-auth.ts:242`, dan `wp.roles` berasal dari respons auth produksi.
- **ID harus sama di kedua DB.** `users` mirror di-upsert dengan kunci `wpUserId` dari
  produksi. Kalau ID di wp314 berbeda, akun bisa login tapi datanya tidak ketemu.

## Keadaan sekarang

| Email | wp580 (produksi) | wp314 (staging) | Target |
|---|---|---|---|
| `dinnikhae@gmail.com` | id 120, `kiviCare_doctor` | id 120, `kiviCare_doctor` | psikolog — **sudah beres** |
| `khaeranidinni12@gmail.com` | id 115, `kiviCare_patient` | id 115, `kiviCare_patient` | admin — **perlu ubah role di produksi** |
| `whiteenjel277@gmail.com` | id 920, `customer` | **tidak ada** | klien — perlu ditambahkan ke wp314 |

ID 920 sudah dicek: **kosong** di wp314, aman dipakai.

---

# BAGIAN 1 — di wp-admin produksi

`https://appointment.praktiqu.com/wp-admin` → **Users**

### 1a. Reset password ketiganya

Buka tiap user → **Set New Password** → isi manual (jangan pakai generator, nanti tidak
terbaca) → **Update User**.

Usulan password (gampang diketik tester, tapi lolos syarat WP):

| Email | Password usulan |
|---|---|
| `whiteenjel277@gmail.com` | `TesterKlien2026!` |
| `dinnikhae@gmail.com` | `TesterPsikolog2026!` |
| `khaeranidinni12@gmail.com` | `TesterAdmin2026!` |

⚠️ Hilangkan centang **"Send User Notification"** kalau tidak mau email masuk ke inbox
mereka.

### 1b. Ubah role

| Email | Dari | Jadi | Alasan |
|---|---|---|---|
| `whiteenjel277@gmail.com` | `customer` | `kiviCare_patient` | `customer` tidak dikenal pemetaan kita — jatuh ke default CLIENT. Jalan, tapi KiviCare juga tidak menganggapnya pasien. Lebih baik eksplisit. |
| `khaeranidinni12@gmail.com` | `kiviCare_patient` | `administrator` | → SUPER_ADMIN (lihat semua klinik) |
| `dinnikhae@gmail.com` | — | — | sudah benar |

**Pilihan untuk akun admin.** `administrator` memberi **SUPER_ADMIN** — akses penuh
lintas klinik. Kalau tester sebaiknya menguji batasan per-klinik, pakai
`kiviCare_clinic_admin` (→ **CLINIC_ADMIN**), yang hanya melihat kliniknya sendiri.
Pilih salah satu; keduanya sah.

---

# BAGIAN 2 — SQL di wp314 (staging)

phpMyAdmin database `praktiqu_wp314`, atau console. **Jalankan berurutan.**

### 2a. Tambahkan whiteenjel277 sebagai pasien

ID **920** dipakai sengaja — harus sama dengan produksi.

```sql
INSERT INTO wp_users
  (ID, user_login, user_pass, user_nicename, user_email, user_url,
   user_registered, user_activation_key, user_status, display_name)
VALUES
  (920, 'whiteenjel277', '!locked-auth-is-in-wp580', 'whiteenjel277',
   'whiteenjel277@gmail.com', '', '2026-07-28 03:44:12', '', 0, 'whiteenjel277');
```

`user_pass` sengaja diisi nilai yang **tidak mungkin cocok** dengan hash apa pun.
Password akun ini hidup di produksi (Bagian 1a); kolom ini tidak pernah dibaca. Mengisi
hash asli di sini justru menduplikasi kredensial ke tempat kedua tanpa manfaat.

```sql
INSERT INTO wp_usermeta (user_id, meta_key, meta_value) VALUES
  (920, 'wp_capabilities', 'a:1:{s:16:"kiviCare_patient";b:1;}'),
  (920, 'wp_user_level',   '0'),
  (920, 'nickname',        'whiteenjel277'),
  (920, 'first_name',      'Tester'),
  (920, 'last_name',       'Klien'),
  (920, 'basic_data',      '{"mobile_number":"","gender":"","dob":null,"address":"","city":"","country":"","postal_code":"","blood_group":""}');
```

Format `wp_capabilities` itu array PHP terserialisasi. `s:16` **harus** 16 — panjang
persis `kiviCare_patient`. Salah angka = role tidak terbaca sama sekali.

### 2b. Petakan ke klinik

Tanpa ini, klien tidak terlihat oleh staf yang dibatasi per-klinik.

Lihat klinik yang ada dulu:

```sql
SELECT id, name FROM wp_kc_clinics WHERE status = 1 ORDER BY id;
```

Lalu (ganti `<CLINIC_ID>`):

```sql
INSERT INTO wp_kc_patient_clinic_mappings (patient_id, clinic_id, created_at)
VALUES (920, <CLINIC_ID>, NOW());
```

### 2c. Samakan role admin di sisi data

Hanya kalau Bagian 1b mengubah `khaeranidinni12` jadi `administrator`. Role JWT datang
dari produksi, tapi menyamakan sisi data mencegah kebingungan nanti:

```sql
UPDATE wp_usermeta
   SET meta_value = 'a:1:{s:13:"administrator";b:1;}'
 WHERE user_id = 115 AND meta_key = 'wp_capabilities';
```

(`s:13` = panjang `administrator`.)

### 2d. Pastikan psikolog punya pemetaan klinik

```sql
SELECT * FROM wp_kc_doctor_clinic_mappings WHERE doctor_id = 120;
```

Kalau kosong, tambahkan:

```sql
INSERT INTO wp_kc_doctor_clinic_mappings (doctor_id, clinic_id, created_at)
VALUES (120, <CLINIC_ID>, NOW());
```

---

# BAGIAN 3 — verifikasi

Login lewat API untuk memastikan role-nya benar:

```bash
curl -s -X POST https://staging2.praktiqu.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"whiteenjel277@gmail.com","password":"TesterKlien2026!"}'
```

Yang harus terlihat di respons:

- `user.role` = `CLIENT` / `PROFESSIONAL` / `SUPER_ADMIN` sesuai akunnya
- `user.wpUserId` = **920 / 120 / 115** — kalau berbeda, ID di wp314 tidak sinkron
- `accessToken` ada

Lalu cek akunnya muncul di data:

```sql
SELECT ID, user_email FROM wp_users WHERE ID IN (115, 120, 920);
```

Dan klien barunya terbaca aplikasi — harusnya total naik dari 752 jadi 753:

```bash
curl -s https://staging2.praktiqu.com/api/v1/clients \
  -H "Authorization: Bearer <TOKEN_ADMIN>" | head -c 200
```

---

## Kalau ada yang meleset

| Gejala | Sebabnya biasanya |
|---|---|
| Login 401 | Password belum di-reset **di produksi** (Bagian 1a), bukan masalah wp314 |
| Login sukses tapi role salah | Role di **produksi** belum diubah (Bagian 1b) |
| Login sukses, tapi profil/data kosong | ID di wp314 ≠ ID produksi, atau `wp_capabilities` salah panjang string |
| Klien tidak muncul di daftar staf | Pemetaan klinik (2b) belum dibuat |
