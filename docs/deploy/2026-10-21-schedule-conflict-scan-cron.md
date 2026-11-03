# Cron pemindaian bentrok jadwal (per jam)

Spec: `docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md`.

## Urutan rilis: SQL → BE → cron

Tidak ada perubahan plugin.

1. **SQL** — terapkan di database Hostinger (`u580667380_nnmkapn`) sebelum merge:

   ```bash
   mysql -u <user> -p u580667380_nnmkapn < prisma/manual/2026-10-21-schedule-conflict-notices.sql
   ```

   `CREATE TABLE IF NOT EXISTS`, jadi aman dijalankan ulang. Tanpa tabel ini setiap run menjawab 500.

2. **BE** — merge PR ke `main`. Build Hostinger menjalankan `prisma generate && next build`, jadi model
   `ScheduleConflictNotice` ikut otomatis. Periksa build-nya benar-benar jalan
   (`hbuilds/logs/<build>/…_deploy.log` menyebut commit merge-nya) — auto-deploy pernah melewatkan merge.

3. **Cron** — buat `~/schedule-conflict-scan.sh`. Bentuknya sama dengan `~/google-conflict-scan.sh`
   (dicek 2026-10-22); hanya URL, berkas log, dan komentarnya yang berbeda:

   ```bash
   cat > ~/schedule-conflict-scan.sh <<'SKRIP'
   #!/bin/bash
   # Pemindaian bentrok jadwal per jam (endpoint.praktiqu.com).
   # Dipasang lewat hPanel -> Cron Job -> Kustom, tiap jam.
   # Spec: docs/superpowers/specs/2026-10-21-deteksi-bentrok-jadwal-design.md
   #
   # CRON_SECRET dibaca saat jalan dari .env yang ditulis hPanel untuk app Node.js,
   # jadi rahasianya tidak tersalin ke skrip ini dan ikut berganti bila env diubah.
   # Rahasia dioper lewat stdin (curl -K -), bukan argumen: di shared hosting daftar
   # argumen proses terbaca pengguna lain lewat ps.
   set -u
   URL="https://endpoint.praktiqu.com/api/v1/internal/schedule-conflicts/scan"
   ENV_FILE="$HOME/domains/endpoint.praktiqu.com/hbuilds/config/.env"
   LOG="$HOME/schedule-conflict-scan.log"

   SECRET=$(grep -m1 '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed -E "s/^[\"']//; s/[\"']\$//")
   if [ -z "$SECRET" ]; then
     printf '[%s] CRON_SECRET tidak ditemukan di %s\n' "$(date -Is)" "$ENV_FILE" >> "$LOG"
     exit 1
   fi

   OUT=$(printf 'header = "x-cron-secret: %s"\n' "$SECRET" \
         | curl -sS -K - --max-time 300 -X POST -w '\nHTTP %{http_code}\n' "$URL" 2>&1)
   printf '[%s] %s\n' "$(date -Is)" "$(printf '%s' "$OUT" | tr '\n' ' ')" >> "$LOG"
   SKRIP
   chmod 700 ~/schedule-conflict-scan.sh
   ```

   Lalu di hPanel → Advanced → Cron Jobs → Kustom (tidak ada `crontab` lewat SSH), tambahkan:

   ```
   0 * * * * /home/u580667380/schedule-conflict-scan.sh
   ```

## Yang dibutuhkan environment

- Tabel `schedule_conflict_notices`.
- `CRON_SECRET` — sudah terpasang untuk pemindaian Google (cron-nya jalan tiap hari 00:00 UTC, HTTP 200).
  Kosong berarti endpoint-nya menolak semua permintaan (503), dan itu disengaja.

## Run pertama

Run pertama melaporkan setiap bentrok yang SUDAH ada di antara janji temu aktif yang akan datang. Itu
disengaja — bentroknya nyata. Untuk melihat lebih dulu apa yang akan dikirim, jalankan kueri di
`findOverlappingAppointmentPairs` (`src/repositories/wp/appointments.repo.ts`) secara read-only dengan
tanggal kemarin.

## Memeriksa bahwa ia benar-benar berjalan

```bash
tail -5 ~/schedule-conflict-scan.log
```

Tiap baris memuat ringkasan `{pairs, recipients, notified, failed}` dan status HTTP. `pairs: 0` berarti
tidak ada bentrok — bukan kegagalan. Status selain 200, atau tidak ada baris baru dalam satu jam, berarti
cron atau endpoint-nya mati. `failed` di atas 0 berarti ada email yang gagal; ia dicoba lagi jam berikutnya,
dan detailnya ada di log aplikasi (`[schedule-conflict-scan] email gagal terkirim`).

Menjalankannya manual:

```bash
~/schedule-conflict-scan.sh && tail -1 ~/schedule-conflict-scan.log
```

## Mematikannya

Hapus baris cron di hPanel. Tabelnya boleh dibiarkan; ia hanya dibaca dan ditulis oleh pemindaian ini.
