# Landing page Pamela Anggia Dewi — versi Inggris, dibangun ulang

**Tanggal:** 2026-08-26
**Status:** disetujui, siap direncanakan
**Keluaran:** `landing-page/pamela-anggia-dewi-en.html` — satu file HTML mandiri

## Kenapa

`landing-page/psikolog-pamela-anggia-dewi.html` adalah tarikan mentah Elementor dari
WordPress lama: 17 MB, 17.181 baris, penuh bundel plugin yang tak terpakai. Klien
(Pamela) meminta empat hal:

1. Halaman diubah ke Bahasa Inggris.
2. **Certified International Brainspotting Consultant & Therapist** harus terlihat jelas
   di bawah namanya — "ini yang jadi kekuatan, orang nyari karena ini".
3. Years of experience: lebih dari 16 tahun (sekarang tertulis 13).
4. Clients lebih dari 1500 (sekarang 800–1000), Hours lebih dari 8000 (sekarang ≥5500).

Di halaman sekarang kredensial itu justru terkubur paling bawah, di baris "Member Of",
dan logo **Brainspotting Indonesia** di baris itu berwarna putih di atas latar putih —
tidak terlihat sama sekali. Permintaan klien dan cacat halaman menunjuk ke arah yang sama.

## Ruang lingkup

One-off untuk Pamela. Isi boleh di-hardcode. Ini **bukan** template untuk 20 psikolog
lain, dan bukan bahan untuk komponen React — kalau nanti dibutuhkan, itu pekerjaan lain.

Tanpa header nav dan tanpa footer situs PraktiQu. Halaman berdiri sendiri, dari hero
sampai closing CTA.

File lama tidak disentuh; ia arsip.

## Struktur halaman

| # | Section | Isi |
|---|---|---|
| 1 | Hero | Nama, badge kredensial, paragraf pembuka, tombol Book Appointment + Contact Me, foto cut-out di atas gradasi amber |
| 2 | Credential strip | Logo Brainspotting, Brainspotting Indonesia, ReAttach Academy, Capacitar + satu kalimat penjelas |
| 3 | Stats | 16+ Years of Experience · 1,500+ Clients · 8,000+ Hours with Clients |
| 4 | About Me | Sisa bio: keyakinan, sukacita mendampingi, rentang usia klien |
| 5 | What I Offer | 4 layanan |
| 6 | Areas of Practice | 5 kartu ikon |
| 7 | My Motto | Pull-quote di band amber |
| 8 | FAQs | 5 accordion |
| 9 | Member Of | IPK Indonesia (West Java), HIMPSI Jabar, Keuskupan Bandung |
| 10 | Closing CTA | "Ready to begin?" + dua tombol + nomor WhatsApp |

Section 2, 4, dan 10 baru. Section 2 memindahkan empat logo modalitas keluar dari
"Member Of" ke bawah hero. Section 4 memecah bio yang sekarang menumpuk jadi satu blok
raksasa di hero. Section 10 ada karena tanpa footer halaman akan berhenti mendadak di
baris logo.

## Naskah

Ejaan British (*counselling*, *honour*) — lazim di kalangan psikologi Indonesia.

### Hero

Nama: **Pamela Anggia Dewi, M.Psi., Psikolog**

Badge: **Certified International Brainspotting Consultant & Therapist**

> I am a clinical psychologist and an internationally certified psychotherapist. I work
> across self-healing, self-regulation, performance enhancement & personal
> growth-manifesting — through an integrative approach drawing on the psychotherapies I
> have trained in deeply: Brainspotting, ReAttach, and a range of Capacitar techniques
> (Tai Chi dance, EFT, fingerholds, and more).

"performance enhancement & personal growth-manifesting" adalah kata-kata Pamela sendiri,
diberikan 2026-08-26. Menggantikan "performance enhancement, and personal growth" di
revisi pertama.

### Credential strip

Eyebrow: **Trained & Certified In**

> Brainspotting is a brain–body/neuroexperiential psychotherapy that works with a fixed
> point of gaze to reach experiences held deeper than words. I use it alongside ReAttach
> and Capacitar, combining the three to suit each person I work with.

Kalimat ini tidak ada di sumber mana pun — dikarang untuk revisi pertama, dan ditandai
sebagai klaim klinis yang harus diaminkan Pamela. **Pamela sudah mengoreksinya sendiri**
2026-08-26: "brain–body" jadi "brain–body/neuroexperiential". Sisa kalimatnya ia biarkan,
jadi bagian itu sekarang berdiri atas persetujuannya, bukan karanganku semata.

### Stats

`16+` Years of Experience · `1,500+` Clients · `8,000+` Hours with Clients

### About Me

> I believe every person carries the capacity to heal, and a quality within them ready to
> shine outward — to give meaning to their own life and to the lives of others. My calling
> is to offer my clients the chance at a new quality of life.
>
> It is a great joy to walk beside a client and watch them become whole, restored, and
> reacquainted with who they truly are.
>
> My clients come from every stage of life — children, adolescents, adults, and older
> adults — from within Indonesia and abroad. It would be an honour to accompany you as you
> find your own true self.

Bio asli berbunyi "menjadi **alatNya**". Atas keputusan pemilik pekerjaan, rujukan iman
itu dinetralkan jadi "My calling is to…". Logo Keuskupan Bandung tetap dipasang di Member
Of — afiliasi lembaga adalah fakta, beda hal dengan pernyataan iman orang pertama.

### What I Offer

- Individual Counselling & Psychotherapy
- Couples & Family Counselling & Psychotherapy
- Group Psychotherapy
- Workshops Based on Psychotherapy

Tanpa deskripsi tambahan. Sumbernya memang cuma judul; mengarang deskripsi berarti
mengarang isi.

Item keempat ditambahkan Pamela 2026-08-26 — tidak ada di halaman lama. Ia menulisnya
"workshop based on psychotherapy"; dijamakkan jadi "Workshops" agar sejajar dengan tiga
item lain yang semuanya nama layanan, bukan satuan.

### Areas of Practice

**Adults** — Depression, with or without suicide attempts; panic attacks; OCD; sexual
violence; bipolar disorder; postpartum depression; anxiety disorders; grief and loss;
loneliness; anger management; trauma of many kinds; delusional disorders; questions of
sexual orientation; phobias; insomnia; addiction (gambling, alcohol, and others), and more.

**Children & Adolescents** — Trauma of many kinds (sexual violence, bullying, feeding
trauma); conduct disorder; grief and loss; anxiety disorders; insomnia; Tourette syndrome;
ADHD; gadget addiction; autism spectrum disorder; gender dysphoria; questions of sexual
orientation; developmental concerns, and more.

**Couples & Families** — Vaginismus; adoption; the relationship between partners; the
parent–child relationship; supporting children through their parents' divorce; infidelity;
support for breastfeeding mothers; postpartum depression, and more.

**Performance Enhancement** — Working with athletes (children, adolescents, adults);
performance anxiety; preparation for military and military-academy selection;
public-speaking performance; personal development more broadly.

**Psychological Support in Medical Conditions** — Support for people living with cancer,
autoimmune conditions, fibromyalgia, COVID-19 and its aftermath, rare forms of Parkinson's
disease, and stroke; preparation for major surgery; and trauma following major surgery.

### My Motto

> “Find your light, rise, and shine.”
> — Pamela Anggia Dewi, M.Psi., Psikolog

### FAQs

1. **Who do you work with?** Toddlers, children, adolescents, adults, and older adults.
2. **How do I make an appointment?** Click **Book Appointment** on this page.
3. **Can I reschedule a session?** Yes. Please confirm no later than the day before.
4. **Can I come in for a session without booking first?** No. You'll need to register and
   complete the intake form first in order to make an appointment.
5. **I'm having difficulty affording this — can I still register?** Please reach out to me
   through the **Contact Me** button on this page.

FAQ #5 di halaman lama menjanjikan "tombol contact me di page ini" yang tidak pernah ada.
Tombol Contact Me di spec ini yang membuat janji itu jadi benar.

### Member Of

IPK Indonesia (West Java) · HIMPSI Jabar · Keuskupan Bandung

Eyebrow "Join Together" dari halaman lama dibuang — Inggris yang janggal, tidak menambah
apa-apa.

### Closing CTA

Judul "Ready to begin?", dua tombol, dan nomor WhatsApp.

### Metadata

```
<title>Pamela Anggia Dewi, M.Psi., Psikolog — Certified International Brainspotting Consultant & Therapist</title>
```

Kata kunci Brainspotting masuk judul karena itu yang dicari orang. `<meta name="description">`
memakai paragraf pembuka hero, dipotong ~155 karakter. `lang="en"`.

## Tautan keluar

| Tombol | Target |
|---|---|
| Book Appointment | `https://appointment.praktiqu.com/appointment-pamela-anggia-dewi-m-psi-psikolog/` |
| Contact Me | `https://wa.me/6285163652908` |

Nomor WhatsApp `+62 851-6365-2908` adalah nomor resmi Pamela untuk klien, dikonfirmasi
olehnya 2026-08-26. Ia menggantikan `+62 811-5424-069` yang dipakai di revisi pertama —
nomor itu ternyata bukan jalur kliennya. Keduanya berbeda dari `+62 878 7051 9230` di
footer halaman lama, yang merupakan nomor PraktiQu.

## Sistem visual

Diambil dari halaman aslinya supaya tetap sekeluarga dengan 20 halaman psikolog lain.

| Peran | Nilai | Asal |
|---|---|---|
| Amber | `#F2CD72` | band statistik & motto di halaman lama |
| Gradasi hero | `radial-gradient(at center right, #F2CD72 0%, #FFFFFF 100%)` | hero halaman lama |
| Oranye dekoratif | `#F0904A` | warna dominan kelima ikon area layanan, disampel dari berkasnya |
| Oranye untuk teks | `#B45A12` | turunan gelap dari yang di atas — `#F0904A` cuma 2,3:1 di atas putih, tidak layak untuk teks; `#B45A12` mencapai 4,8:1 |
| Teks | near-black di atas putih/krem | halaman lama |

Oranye dekoratif hanya untuk garis, keping, dan ikon. Setiap teks berwarna memakai
`#B45A12`. Teks di atas band amber memakai near-black.

Tipografi satu keluarga (Plus Jakarta Sans, dengan fallback system stack), skala 6
tingkat. Spasi kelipatan 8. Kartu memakai border tipis + radius, bukan bayangan tebal.
Satu kolom di bawah 768 px.

Tanpa animasi masuk. Halaman lama memakai `elementor-invisible` (opacity 0 sampai JS
memasang kelas `animated`) — akibatnya semua foto besar tidak muncul sama sekali saat
JS-nya tidak jalan. Kesalahan itu tidak diulang.

## Teknis

Satu file HTML mandiri, sekitar 450 KB, bisa dibuka langsung tanpa server.

- Gambar tertanam sebagai `data:` URI **WebP**. 13 aset yang dipakai turun dari 4,2 MB
  (PNG) jadi sekitar 225 KB (WebP) — hero 900 px lebar/77 KB, ikon 220 px, logo 400 px.
- Tanpa Elementor, tanpa jQuery, tanpa font CDN. CSS ditulis tangan, satu blok `<style>`.
- JavaScript hanya untuk accordion FAQ, sekitar 30 baris, tanpa dependensi. Accordion
  dibangun dengan `<details>`/`<summary>` agar tetap berfungsi tanpa JS.

### Aset

Diekstrak dari file lama, dikonversi ke WebP lewat canvas di headless Chrome (tidak ada
`cwebp`/ImageMagick di mesin ini, dan tidak ada sudo untuk memasangnya).

| Aset | Sumber di file lama | Dipakai di |
|---|---|---|
| Foto Pamela (PNG transparan 1414×2000) | `wp-image-42258` | Hero |
| 5 ikon oranye | `wp-image-38977/38979/38975/38981/44178` | Areas of Practice |
| Logo Brainspotting (hitam) | `wp-image-42274` | Credential strip |
| Logo Brainspotting Indonesia (**putih**) | `wp-image-42326` | Credential strip |
| Logo ReAttach Academy | `wp-image-44186` | Credential strip |
| Logo Capacitar Nusantara | `wp-image-42321` | Credential strip |
| Logo IPK Indonesia Jabar | `wp-image-42322` | Member Of |
| Logo HIMPSI Jabar | `wp-image-42327` | Member Of |
| Logo Keuskupan Bandung | `wp-image-42328` | Member Of |

Logo Brainspotting Indonesia berwarna putih. Di halaman lama ia dipasang di atas latar
putih dan karena itu tak terlihat. Perbaikannya: taruh di atas keping (*chip*) berlatar
gelap di credential strip. Warna berkasnya tidak diubah — yang salah adalah latarnya.

Dua foto dekoratif (padang bunga saat senja, `wp-image-44184` dan `wp-image-42338`) dan
ilustrasi dokter-bersuntik bawaan tema tidak dipakai. Foto padang bunga itu stok generik
yang tidak menambah apa pun; ilustrasi dokter milik tema KiviCare, bukan milik Pamela.

## Yang sengaja tidak dikerjakan

- **File lama tidak diubah.** Ia arsip; `MANIFEST.md` mencatat asal-usulnya.
- **20 halaman psikolog lain tidak disentuh.** Ruang lingkupnya one-off.
- **Versi Indonesia tidak dibuat.** Klien minta halaman diubah ke Inggris, bukan
  dwibahasa.
- **Form booking tidak dibuat berfungsi.** Tombol menautkan ke halaman booking WordPress
  yang sudah ada, sama seperti sekarang.

## Catatan penyerahan

`landing-page/` ada di `.gitignore` (baris 76), jadi file keluaran **tidak masuk git**.
Yang di-commit hanya dokumen spec ini. Kalau halaman ini perlu diversikan, direktorinya
harus dikeluarkan dulu dari `.gitignore` — keputusan tersendiri, karena arsip 347 MB di
sebelahnya memang sengaja tidak dilacak.

## Verifikasi

Otomatis, lewat `landing-page/src/pamela-en/verify.mjs` — **24/24 lewat**.

| Kriteria | Hasil terukur |
|---|---|
| Ukuran file di bawah 600 KB | **325 KB** (dari 17,0 MB — turun 98%) |
| Tanpa rujukan eksternal | Satu-satunya URL absolut adalah dua target CTA |
| Tanpa error konsol dari `file://` | Bersih |
| 13 gambar termuat dan terlihat | 13/13, termasuk logo Brainspotting Indonesia yang di halaman lama tak terlihat |
| Angka statistik | 16+ · 1,500+ · 8,000+ |
| Badge kredensial di layar pertama | Selesai di 386 px dari 900 (desktop), 242 px dari 844 (ponsel) |
| Kedua tautan | Semua tombol Book menunjuk halaman booking; semua tombol Contact menunjuk WhatsApp |
| Accordion FAQ | 5 item, terbuka-tutup |
| Tanpa scroll horizontal | 0 px di 390, 768, dan 1440 |
| Tanpa JavaScript | 5 jawaban FAQ tetap di DOM, 3.371 karakter terbaca, 13/13 gambar tetap terlihat |

Baris terakhir itu bukan basa-basi. Halaman lama memasang `opacity: 0` pada tiap foto
besar dan mengembalikannya lewat JavaScript; ketika JS-nya tidak jalan, foto Pamela dan
ketujuh logo hilang semua. Itu regresi yang sekarang dijaga.

Manual, lewat screenshot headless Chrome di 390/768/1440 px. Tiga hal yang lolos dari
pemeriksaan otomatis dan hanya ketahuan dari melihat:

- Kredensialnya makan dua baris di hampir semua lebar kolom, dan radius pil pada blok dua
  baris terbaca seperti kesalahan. Jadi pelat bergaris oranye di kiri, bukan pil.
- Foto yang dipusatkan di grid hero menyisakan pita amber mati di bawah kakinya. Sekarang
  rata bawah, berdiri di batas section.
- Membatasi tinggi logo saja membuat logo Capacitar yang lebar dan tipis tampak mungil di
  sebelah wordmark Brainspotting yang tinggi. Kedua dimensi dibatasi dalam kotak tetap.

Rebuild dari nol berhasil dengan hanya berkas yang di-commit — arsip 17 MB yang
di-gitignore itu tidak dibutuhkan untuk membangun ulang.

## Yang masih perlu Pamela

Kosong. Kedua hal yang menggantung sudah dijawabnya sendiri pada 2026-08-26:

1. ~~Kalimat penjelas Brainspotting~~ — ia mengoreksinya jadi
   "brain–body/neuroexperiential" dan membiarkan sisanya.
2. ~~Nomor WhatsApp~~ — `+62 851-6365-2908`, nomor resminya untuk klien.

Satu hal yang bukan pertanyaan untuknya, tapi perlu dicatat: bio aslinya menyebut
"peningkatan performa" dan "pengembangan diri" sebagai dua hal terpisah. Frasa
"personal growth-manifesting" yang ia pilih tidak lazim dalam bahasa Inggris, tapi itu
kata-katanya sendiri dan dipakai apa adanya.
