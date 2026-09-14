# Halaman legal yang dipasang di luar aplikasi ini

## `privacy-policy.html`

**Terpasang di:** `https://praktiqu.com/privacy-policy.html`
**Lokasi di server:** `/home/praktiqu/public_html/privacy-policy.html` (docroot WordPress
untuk `praktiqu.com` — dipastikan lewat uji tulis-lalu-ambil, bukan ditebak; folder
`~/praktiqu.com` kosong dan tidak dipakai).

Salinannya disimpan di sini karena berkas yang hanya ada di server tidak terlihat siapa pun
dan hilang pada migrasi pertama. **Kalau isinya diubah, ubah di sini lalu salin ke server** —
jangan sebaliknya.

### Kenapa HTML, bukan PHP

Isinya teks statis; tidak ada alasan mengeksekusi kode. Box itu menjalankan Imunify360, yang
pernah mengarantina sebuah berkas secara keliru dan mematikan situs WordPress-nya selama 38 jam
(lihat memory `imunify-quarantine-took-wp-down`). Berkas PHP tulisan tangan di root WordPress
adalah kandidat utama heuristik semacam itu; HTML murni praktis bukan.

Berkasnya nyata di disk, jadi aturan rewrite WordPress (`!-f`) melewatinya dan Apache
menyajikannya langsung — tidak melewati WordPress sama sekali.

### Kenapa ada

Verifikasi OAuth Google mewajibkan kebijakan privasi yang dapat diakses publik, di domain yang
sama dengan homepage aplikasi, yang menyebut data Google secara spesifik dan memuat pernyataan
**Limited Use**. `praktiqu.com` adalah top private domain, jadi ia juga mencakup
`terpadu.praktiqu.com` sebagai authorized domain.

### Yang masih perlu dilengkapi

- **Alamat email kontak.** Sekarang hanya WhatsApp, karena itu satu-satunya kontak yang
  dipublikasikan di praktiqu.com. Peninjau Google biasanya mengharapkan email.
- **Nama badan usaha**, bila ada, untuk bagian "Siapa kami".
- Bagian data non-Google ditulis pada tingkat faktual saja. Kewajiban hukum untuk data
  kesehatan — dasar pemrosesan, masa simpan, pemrosesan lintas negara — perlu ditinjau orang
  yang berwenang, bukan disusun dari tebakan.
