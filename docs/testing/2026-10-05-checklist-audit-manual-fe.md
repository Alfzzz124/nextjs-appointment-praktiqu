# Checklist audit manual Frontend (terpadu.praktiqu.com)

Dipakai untuk mencoba langsung setiap fitur setelah perbaikan audit 2026-09-25 s/d 2026-10-05 (FE #28–#34, BE #20–#24). Setiap baris berisi **apa yang dilakukan**, lalu **→ yang seharusnya terjadi**. Kalau hasilnya berbeda, catat di bagian paling bawah.

> ⚠️ **terpadu memakai data produksi.** Booking, pembayaran, email, dan PIN di sini sungguhan. Pakai klinik/layanan uji (idealnya layanan berharga Rp0 atau sangat kecil) dan email milikmu sendiri, lalu batalkan janji temu uji setelah selesai.

---

## 0. Persiapan

- [ ] Backend `endpoint.praktiqu.com` sudah menjalankan `main` terbaru (≥ `c219f8a`, PR #24)
- [ ] FE sudah ter-deploy dari `main` terbaru (≥ `e5afd8b`, PR #34). Cek tab Actions: job deploy hijau, dan langkah "Verify" mengecek `/`, `/up`, `/staff/login`
- [ ] Plugin WordPress **1.6.8** sudah di-upload (`/wp-json/praktiqu/v1/health` menyebut versinya)
- [ ] Webhook jobs plugin mengarah ke `/api/v1/webhooks/wordpress-jobs` (dibutuhkan oleh pembatalan otomatis dan pengingat)
- [ ] Env terpadu: `PRAKTIQU_API_BASE=https://endpoint.praktiqu.com`, `PRAKTIQU_FORWARDER_SECRET` sama dengan `FE_FORWARDER_SECRET` di backend
- [ ] Akun uji yang perlu disiapkan:
  - [ ] Super admin
  - [ ] Admin klinik (klinik A)
  - [ ] Resepsionis (klinik A)
  - [ ] Psikolog yang praktik di **dua** klinik
  - [ ] Psikolog dengan **ID di atas 50** (pendaftar baru)
  - [ ] Satu email pasien yang bisa kamu buka kotak masuknya
- [ ] Siapkan dua browser (atau satu biasa dan satu jendela incognito) untuk tes yang melibatkan dua sesi

---

## 1. Landing & pintu masuk

- [ ] Buka `/` → landing bahasa Inggris. Tambahkan `?lang=id` → seluruh halaman berbahasa Indonesia. Pindah halaman lalu kembali → bahasanya tetap Indonesia
- [ ] Bagian "Cara Booking" → contoh alamatnya `terpadu.praktiqu.com/nama-klinik`, bukan `appointment.praktiqu.com`
- [ ] Buka `/login`, `/staff`, `/doctor` → dialihkan ke `/staff/login` / `/doctor/login`
- [ ] Login staf dengan password salah 5× berturut-turut → muncul pesan Indonesia untuk menunggu (bukan halaman Inggris "Too Many Requests")
- [ ] Login dengan akun yang **dinonaktifkan** → pesan "Akun ini tidak aktif atau terkunci…" dalam bahasa Indonesia
- [ ] Form login: Tab dari email ke password berjalan wajar, tombol tampilkan sandi bisa dipakai lewat keyboard, dan pengelola sandi browser menawarkan isi otomatis
- [ ] **Lupa sandi**: kirim untuk email terdaftar → email reset datang. Kirim 7× dalam semenit → pesan Indonesia di form, bukan halaman 429 Inggris
- [ ] Buka tautan reset dari email → bisa membuat sandi baru, lalu login dengan sandi itu
- [ ] Biarkan halaman login terbuka **lebih dari 2 jam**, lalu tekan Masuk → kembali ke form login dengan pesan "Sesi Anda berakhir…", bukan "419 Page Expired"

---

## 2. Booking publik (pasien)

### 2a. Membuka halaman
- [ ] Buka `/{slug-klinik}` → daftar psikolog klinik itu tampil
- [ ] Buka `/{slug-nama-psikolog}` untuk psikolog lama → langsung ke layanan psikolog itu
- [ ] Buka `/{slug-nama-psikolog}` untuk **psikolog ber-ID di atas 50** → halamannya terbuka (dulu 404)
- [ ] Buka `/{slug-ngawur}` → halaman "tidak ditemukan", bukan error server
- [ ] Di klinik dengan banyak psikolog: pilih satu psikolog, lalu tekan Kembali di langkah pertama → kembali ke daftar psikolog tanpa perlu reload

### 2b. Mengisi pesanan
- [ ] Pilih layanan, tanggal, dan jam **hanya dengan keyboard** (Tab, Enter/Spasi) → semuanya bisa dipilih
- [ ] Label jam bertuliskan **WIB**. Kalau zona waktu perangkat diubah ke WITA → tampil misalnya "10:00 WIB (11:00 waktu Anda)"
- [ ] Tidak ada kotak kupon/promo sama sekali
- [ ] Kolom keluhan: penghitung sisa karakter muncul, dan teks berhenti di 1000 karakter
- [ ] Di HP: setiap pindah langkah, halaman menggulir ke atas dan tombol tidak menutupi isian

### 2c. Sesi gratis (layanan Rp0)
- [ ] Selesaikan booking → layar sukses dengan nomor register, tanpa dilempar ke halaman bayar
- [ ] Statusnya berubah menjadi terkonfirmasi beberapa detik kemudian, bukan tertahan "menunggu" selamanya
- [ ] Email PIN untuk Cek Hasil diterima

### 2d. Sesi berbayar (Xendit)
- [ ] Selesaikan booking → langsung diarahkan ke halaman bayar Xendit. Jumlah yang ditagih sama dengan "Total Tagihan" di layar
- [ ] Bayar → kembali ke terpadu **tanpa 404**. Layar sukses menampilkan nomor register dan status "lunas"
- [ ] Ulangi, tapi buka halaman bayar Xendit di **tab/aplikasi lain**, bayar di sana, lalu kembali → status tetap terpulihkan (dulu hilang karena sessionStorage)
- [ ] Ulangi, lalu tekan **batal** di Xendit → kembali ke halaman dengan tombol "Lanjutkan Pembayaran" yang berfungsi
- [ ] Tutup tab checkout sebelum membayar, lalu buka lagi halaman klinik → tombol "Lanjutkan Pembayaran" masih ada
- [ ] Email PIN diterima juga untuk booking **berbayar** (dulu hanya untuk yang gratis)

### 2e. Kasus sulit
- [ ] Dua browser memesan jam yang sama hampir bersamaan → yang kedua mendapat pesan "jam ini baru saja terisi", lalu dikembalikan ke pilihan jadwal dengan jam itu sudah hilang
- [ ] Tekan tombol pesan berkali-kali dengan cepat → hanya **satu** janji temu yang tercatat
- [ ] Biarkan halaman booking terbuka lebih dari 2 jam, lalu kirim → tetap berhasil (token diperbarui otomatis) atau pesan Indonesia yang jelas
- [ ] Booking, lalu **jangan bayar** dan tutup semuanya → setelah ±60 menit, janji temu itu dibatalkan dan jamnya kembali tersedia. Email pembatalan dari KiviCare ikut terkirim (butuh plugin 1.6.8 dan webhook)

---

## 3. Portal pasien (`/cek-hasil`)

- [ ] Masukkan PIN dari email → daftar janji temu dan hasil terbuka. **Tempel** PIN beserta spasinya pun tetap diterima
- [ ] Jadwal yang tampil sesuai jadwal terkini. Pindahkan jadwal itu di KiviCare → halaman pasien ikut berubah
- [ ] Status berbahasa Indonesia ("Terjadwal", "Selesai", "Dibatalkan" berwarna merah), dan tanggalnya juga berbahasa Indonesia ("Kamis, 20 Agustus 2026")
- [ ] "Belum punya PIN?" → PIN baru dikirim. **PIN lama masih berlaku** sampai PIN baru dipakai pertama kali
- [ ] Masukkan PIN salah 10× → dibatasi. Lalu masukkan PIN yang benar milikmu → hitungan salahnya **tidak** hilang
- [ ] Unduh berkas hasil → berkasnya terbuka/terunduh dengan nama yang benar
- [ ] Tekan "Keluar", lalu tombol Back browser → halaman hasil **tidak** tampil lagi dari cache

---

## 4. Dashboard staf: berlaku untuk semua peran

- [ ] Menu sesuai peran:
  - **Super** melihat semua menu
  - **Admin/resepsionis** tidak melihat Doctors, Receptionists, Clinics, Request Features, maupun Log Sistem
  - **Psikolog** tidak melihat Billing maupun Reports
- [ ] Kartu pendapatan: setelah backend #24 live, labelnya **"Total Revenue"** dan hanya menghitung tagihan lunas
- [ ] **Sesi habis**: biarkan dashboard terbuka lebih dari 2 jam, lalu simpan sesuatu → banner kuning "Sesi Anda berakhir" dengan tautan "Masuk lagi di tab baru". Isian di modal tidak hilang
- [ ] **Token 15 menit**: biarkan dashboard 20 menit tanpa aktivitas, lalu lanjut bekerja (buka dokumen, simpan) → berjalan normal, tidak tiba-tiba ter-logout
- [ ] Buka dua tab dashboard, biarkan 20 menit, lalu klik di kedua tab hampir bersamaan → **tidak** ter-logout acak
- [ ] Keluar → setelah itu tombol Back tidak membuka dashboard
- [ ] **Keyboard**:
  - menu samping bisa dijalani dengan Tab
  - sakelar status bisa diubah dengan Enter/Spasi
  - di dalam modal, Tab tidak keluar dari modal
  - Escape menutup modal
- [ ] Klik di luar modal saat isian sudah diubah → muncul pertanyaan "Buang isian yang belum disimpan?". Saat request sedang berjalan, klik di luar diabaikan
- [ ] Teks di dialog dan pesan berbahasa Indonesia, tanpa catatan developer atau slang
- [ ] Tampilan di HP (lebar ±380px): tabel bisa digulir, dan modal tidak melebihi layar

---

## 5. Dashboard per menu

### Dashboard (halaman depan)
- [ ] Kartu "Upcoming" berisi janji temu **mulai hari ini**, bukan yang paling lama
- [ ] Admin klinik: **tidak ada** spanduk "data di luar cakupan", dan statistik serta grafik tampil
- [ ] Resepsionis: dashboard terisi (dulu selalu kosong)
- [ ] Kartu "Jadwal Psikolog" tidak menampilkan "0 sesi" palsu

### Appointments
- [ ] Daftar terisi untuk admin klinik dan resepsionis (dulu kosong karena error 422)
- [ ] Filter tanggal (Cari/Reset) bekerja, dan pager tetap memakai rentang yang sama di halaman berikutnya
- [ ] "Tandai lunas & terjadwal" dan "Check-out" meminta konfirmasi dengan nama klien dan jam
- [ ] Kolom Layanan terisi
- [ ] **Log Waktu**: jam selesai sebelum jam mulai ditolak, tidak tersimpan sebagai durasi 0. Opsi "Dibatalkan" tidak ada untuk log baru

### Appointment Manual
- [ ] **Psikolog**: dropdown psikolog hanya berisi dirinya sendiri (terkunci)
- [ ] **Admin/resepsionis**: hanya psikolog kliniknya, dan janji temu tercatat di **klinik itu**, termasuk untuk psikolog yang praktik di dua klinik
- [ ] **Super admin** tanpa memilih klinik: bisa memilih psikolog **ber-ID di atas 50**
- [ ] Cari klien → hasilnya hanya klien yang boleh dilihat peran itu. Klien dari klinik lain tidak muncul
- [ ] Klien tanpa nomor HP → diminta mengisi nomor HP
- [ ] Ganti psikolog, layanan, atau tanggal → jam yang tadi dipilih ter-reset
- [ ] Setelah sukses → nomor register tampil, janji temu muncul di daftar Appointments, dan **tidak** dibatalkan otomatis setelah 60 menit

### Encounters & dokumen
- [ ] Buka dokumen encounter **setelah 20 menit** di dashboard → terbuka, tidak error 502
- [ ] Unggah dokumen setelah 20 menit tanpa aktivitas → berhasil
- [ ] Unduh dokumen → nama berkasnya nama asli, bukan "content"
- [ ] Ganti nama dan hapus dokumen → berhasil. Lampiran dari booking tidak bisa diubah

### Clients
- [ ] Ketik di kotak cari → mencari ke **seluruh** klien, bukan hanya 100 baris yang termuat
- [ ] Urutan klien: yang terbaru di atas. Kolom Klinik terisi
- [ ] **Psikolog** hanya melihat kliennya sendiri, tidak punya tombol Tambah Klien, dan sakelarnya hanya baca
- [ ] Sakelar Aktif/Nonaktif bekerja
- [ ] Ikon hapus: nonaktif selama klien masih aktif. Setelah klien dinonaktifkan → muncul konfirmasi "Arsipkan?"

### Hasil Klien
- [ ] Unggah hasil → email ke klien terkirim, dan statusnya "✓ terkirim"
- [ ] **"Tarik hasil ini"** → hasil hilang dari portal pasien, dengan pesan bahwa email yang sudah terkirim tidak bisa ditarik
- [ ] Riwayat klien (klik nomor register) tampil
- [ ] Tab PIN klien → kirim ulang PIN berhasil

### Doctors (super)
- [ ] Tambah psikolog dengan tipe profesional dan nomor registrasi (format `AAA-NNNNN-YYYY`) → berhasil (dulu selalu gagal)
- [ ] Sakelar status psikolog bekerja

### Receptionists (super)
- [ ] Tambah resepsionis → berhasil, dan email selamat datang berisi password diterima
- [ ] Sakelar Aktif menunjukkan status yang benar (dulu terbalik)
- [ ] **Nonaktifkan resepsionis yang sedang login** di browser lain → dalam ±15 menit dia ter-logout dan tidak bisa masuk lagi

### Services
- [ ] Daftar memuat **semua** layanan, termasuk yang nonaktif (dulu cuma 20)
- [ ] Tambah, ubah, dan hapus layanan. Ubah layanan **tidak** mewajibkan memilih psikolog

### Doctor Sessions (jadwal)
- [ ] Buka "Atur Jadwal" lalu Simpan **tanpa mengubah apa pun** → jadwal tetap sama persis (dulu bergeser/terpotong)
- [ ] Buat istirahat di bawah 15 menit → ditolak dengan pesan Indonesia sebelum dikirim
- [ ] Mode per-sesi: durasi setiap sesi mengikuti "Durasi per Sesi"
- [ ] **Ekspor CSV** mengunduh berkas (dulu 404)
- [ ] Hapus massal: centang beberapa jadwal → nama psikolog disebut di konfirmasi. Baris tanpa klinik dilewati dan disebutkan

### Billing & Reports
- [ ] Reports: pilih rentang tanggal → kolom uang dan tanggal terisi
- [ ] **Super**: pemilih klinik tersendiri ("Semua klinik" / satu klinik). Pendapatan per klinik hanya dari klinik itu, dan cakupannya tertulis di atas hasil
- [ ] Per psikolog / per klien: tidak ada baris ganda karena nama yang sama
- [ ] Unduh CSV → klien bernama `=1+1` tampil sebagai teks di Excel, tidak dieksekusi sebagai rumus
- [ ] Subjudul pendapatan menyebut "X lunas dari Y tagihan"

### Settings (psikolog)
- [ ] Google Calendar: hubungkan dan putuskan berhasil. "Tersambung sejak" dalam WIB
- [ ] Sesi habis di halaman ini → dikembalikan ke portal **psikolog**, bukan portal staf

### Request Features & Log Sistem (super)
- [ ] Kirim permintaan fitur → tersimpan, dan dibatasi kalau terlalu sering
- [ ] Log Sistem tampil, dan tidak ikut kosong setelah membuka modal Log Waktu

---

## 6. Cek keamanan cepat

- [ ] Login sebagai **psikolog A**, buka URL dokumen/hasil/klien milik psikolog B (ganti ID di URL) → 404 atau ditolak, bukan datanya
- [ ] Login sebagai **admin klinik A**, coba buka hal yang sama milik klinik B → ditolak
- [ ] Coba buka `terpadu.praktiqu.com` di dalam iframe situs lain → ditolak browser (anti-clickjacking)
- [ ] Setelah forwarding IP aktif: login sekali, lalu cek `audit_logs.ip` di backend → berisi IP kamu, bukan IP server terpadu

---

## Catatan temuan

| # | Halaman / fitur | Peran | Langkah | Yang terjadi | Yang diharapkan | Screenshot |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
