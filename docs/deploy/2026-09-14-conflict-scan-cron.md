# Cron pemindaian bentrok Google Calendar (Fase 5)

Terpasang di staging 2026-09-14.

## Apa yang berjalan

```
0 7 * * * /home/praktiqu/google-conflict-scan.sh
```

Skripnya memanggil `POST /api/v1/internal/google-calendar/conflict-scan` dan menulis satu
baris ke `~/google-conflict-scan.log`. Berkasnya `700`, dan rahasianya dioper lewat
**stdin** (`curl -K -`), bukan argumen: di shared hosting daftar argumen setiap proses
terbaca pengguna lain lewat `ps`, jadi `-H "x-cron-secret: …"` akan membocorkannya ke
seluruh mesin.

## Kenapa cron server, bukan Action Scheduler

Action Scheduler di instalasi ini pernah macet dan mati berminggu-minggu tanpa ada yang
sadar (lihat memory `action-scheduler-dead-since-sep-5`). Pola alternatifnya — job yang
menjadwalkan dirinya untuk besok — punya kelemahan yang sama: satu kegagalan memutus
rantainya selamanya. Satu baris crontab sembuh sendiri; hari yang gagal terlewat, hari
berikutnya tetap berjalan.

## Yang dibutuhkan environment

- Tabel `google_conflict_warnings` — `prisma/manual/2026-09-14-google-conflict-warnings.sql`
- `CRON_SECRET` — 32 byte acak, **berbeda per environment**. Kosong berarti endpoint-nya
  menolak semua permintaan (503), dan itu disengaja.
- Prisma Client harus di-generate ulang setelah deploy: model `GoogleConflictWarning` baru,
  dan deploy `.next` saja tidak memperbaruinya.

## Memeriksa bahwa ia benar-benar berjalan

```bash
tail -5 ~/google-conflict-scan.log
```

Tiap baris memuat ringkasan dan status HTTP. `scanned: 0` berarti tidak ada koneksi Google
yang aktif — bukan kegagalan.

Menjalankannya manual (dari server, rahasianya dibaca dari proses yang hidup):

```bash
~/google-conflict-scan.sh && tail -1 ~/google-conflict-scan.log
```
