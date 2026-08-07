# Final Migration Checklist

Hal-hal yang **sengaja ditunda** selama masa semi-staging, dan harus dikerjakan saat aplikasi benar-benar pindah ke domain produksi (`appointment.praktiqu.com` atau domain aplikasi final).

Kondisi sekarang: aplikasi Next jalan di `staging2.praktiqu.com`, tapi WordPress-nya adalah `appointment.praktiqu.com` yang **hidup** — 850 user, form booking aktif, email keluar ke pasien sungguhan. Itu sebabnya beberapa perubahan di bawah ditahan: mengubahnya sekarang berarti mengarahkan pasien nyata ke aplikasi yang belum siap.

Terakhir diperbarui: 2026-08-07.

---

## A. Link login di email KiviCare ⭐ alasan dokumen ini dibuat

Email selamat datang pasien memuat *"Login through this link https://appointment.praktiqu.com/wp-login.php"*. Pasien diarahkan ke halaman login WordPress, bukan ke aplikasi.

| | |
|---|---|
| Letak | Database `praktiqu_wp580`, tabel `wp_posts`, **ID 44** (`post_name = kivicare_patient_register`) |
| Isi sekarang | `... Login through this link {{login_url}} and or make another appointment in this url {{appointment_page_url}} .` |
| Kenapa jadi wp-login | `{{login_url}}` diterjemahkan KiviCare lewat `wp_login_url()` — lihat `KCEmailTemplateProcessor.php:224` |
| Yang harus dilakukan | Ganti `{{login_url}}` dengan URL absolut halaman login aplikasi, mis. `https://appointment.praktiqu.com/login` |

```sql
-- praktiqu_wp580
UPDATE wp_posts
SET post_content = REPLACE(post_content, '{{login_url}}', 'https://<DOMAIN-FINAL>/login')
WHERE ID = 44;
```

**Jangan** memakai filter `login_url` WordPress untuk ini. Filter itu berlaku untuk seluruh situs termasuk pengalihan `wp-admin`, dan bisa mengunci admin dari WordPress.

⚠️ Ada **tiga baris duplikat** template yang sama (ID 64, 38545, 38566) tanpa link. Hanya ID 44 yang dipakai. Kalau ID 44 pernah terhapus, salah satu duplikat akan menang dan link-nya hilang diam-diam — periksa lagi kalau isi email tiba-tiba berubah.

`{{appointment_page_url}}` dibiarkan apa adanya; sudah mengarah ke halaman booking WordPress dan itu memang benar.

---

## B. Variabel environment

Semua di cPanel → Setup Node.js App → aplikasi terkait → Environment variables. **Bukan** `.htaccess`; `SetEnv` di sana tidak berpengaruh. Awas spasi di ujung nama key — pernah membuat `PAYMENT_WEBHOOK_SECRET` tidak terbaca tanpa error apa pun.

| Variabel | Sekarang | Saat migrasi |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://staging2.praktiqu.com` | Domain final. **Ini yang membangun link di email reset password** — kalau tidak diganti, email produksi mengarah ke staging |
| `AUTH_URL` | `https://staging2.praktiqu.com` | Domain final |
| `NEXTAUTH_URL` | `https://staging2.praktiqu.com` | Domain final |
| `EMAIL_FROM` | `PraktiQU <no-reply@appointment.praktiqu.com>` | Cocokkan dengan domain final, dan verifikasi domainnya di Resend |

Sekarang pengirim email (`appointment.praktiqu.com`) dan tujuan link (`staging2.praktiqu.com`) berbeda domain. Tidak merusak apa pun, tapi menurunkan kepercayaan dan bisa memicu filter spam. Samakan saat migrasi.

Ingat: `cloudlinux-selector set --env-vars` **mengganti seluruh set**. Baca dulu `env_vars` yang ada lewat `cloudlinux-selector get --json`, ubah satu key, tulis balik semuanya. Lebih aman lewat UI cPanel.

---

## C. Celah yang harus ditutup sebelum user sungguhan

### C1. Lupa password tidak jalan untuk mayoritas user ⚠️ paling berdampak

[`forgot-password`](../../src/app/api/v1/auth/forgot-password/route.ts) mencari user di tabel aplikasi (`users`), bukan di WordPress. Baris `users` baru terbentuk saat seseorang **login ke aplikasi**.

Dihitung di `praktiqu_wp580` pada 2026-08-07: `wp_users` berisi **850** baris, `users` hanya **61**. Artinya **789 user tidak bisa memakai lupa-password sama sekali** — endpoint tetap membalas `200`, tidak ada email terkirim, dan tidak ada jejak kegagalan. Dari sisi user: "saya sudah minta reset tapi emailnya tidak pernah datang."

Perbaikan: buat `forgot-password` jatuh ke `wpLookupByEmail()` kalau tidak ada baris `users`, lalu buat barisnya (pola yang sama dipakai `login`). Verifikasi 2026-08-07.

### C2. Halaman front-end belum ada

`/forgot-password` dan `/reset-password` belum dibuat. Link di email reset mengarah ke `/reset-password?token=…` dan sekarang menghasilkan 404. Endpoint-nya sudah siap dan sudah diuji — pedoman lengkap untuk tim front-end ada di [PASSWORD-RESET-GUIDE.md](../api/PASSWORD-RESET-GUIDE.md).

### C3. Password terkirim polos di email selamat datang

Email registrasi KiviCare memuat password pilihan pasien dalam teks polos — sudah terbukti nyata pada uji 2026-08-07 (*"your password is rahasia123"*). Ini risiko yang diterima sadar saat membangun registrasi mandiri; sebelum produksi sebaiknya ditutup.

Cara termurah tanpa ubah kode: nonaktifkan template `patient_register` di pengaturan KiviCare, atau hapus `{{user_password}}` dari isi template ID 44 — pasien memilih passwordnya sendiri, jadi tidak perlu dikirimi.

### C4. Permintaan reset tidak tercatat di audit

Helper `audit.passwordResetRequest` ada tapi tidak pernah dipanggil `forgot-password`. Penyelesaian reset tercatat, permintaannya tidak. Timpang kalau nanti perlu menelusuri insiden.

---

## D. Bersih-bersih database dan server

| Item | Keterangan |
|---|---|
| Database `praktiqu_wp314` | Yatim sejak 2026-08-07; tidak ada yang membacanya. **Jangan dihapus** sampai staging terbukti stabil — ini satu-satunya jalan rollback dari pemindahan database |
| Aplikasi Node `staging.praktiqu.com` | Berstatus stopped, memakai wp580. Sisa app lama; hapus kalau sudah pasti tidak dipakai |
| Backup `.next.bak-*` | Menumpuk di `~/staging2.praktiqu.com/` (8+ direktori per 2026-08-07). Sisakan dua yang terbaru |
| Tabel `appointments` | Sudah mati — tidak ada satu pun `prisma.appointment*` di `src/`. Termasuk 41 shadow table yang antre dihapus, lihat `docs/architecture/shadow-tables-audit.md` |

---

## E. Keamanan

| Item | Keterangan |
|---|---|
| Rotasi kunci SSH | Private key server ditempel di percakapan pada 2026-08-06 dan 2026-08-07 (keduanya kunci yang sama, belum diganti). Rotasi sebelum produksi |
| `RESEND_API_KEY` | Terpasang 2026-08-07 dan terbukti berfungsi. Pastikan domain pengirim final terverifikasi di Resend sebelum ganti `EMAIL_FROM` |
| Verifikasi email pendaftar | Registrasi mandiri belum punya verifikasi email / double opt-in. Akun langsung aktif |
| CAPTCHA | Belum ada di registrasi maupun lupa-password. Pengaman satu-satunya adalah rate limit per (IP, email) |

---

## F. Urutan yang disarankan saat migrasi

1. Siapkan domain final dan verifikasi domainnya di Resend.
2. Tutup **C1** — tanpa ini, lupa-password gagal untuk hampir semua user lama.
3. Tutup **C3** — jangan biarkan password polos beredar ke user sungguhan.
4. Pastikan halaman **C2** sudah jadi.
5. Ganti variabel di **B**, restart aplikasi.
6. Jalankan SQL di **A**.
7. Uji asap: daftar → cek email → login → lupa password → reset → login dengan password baru.
8. Setelah stabil beberapa hari, kerjakan **D**.
