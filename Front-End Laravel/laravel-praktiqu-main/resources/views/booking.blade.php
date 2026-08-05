@extends('layouts.base')
@section('title', $tenant['name'].' — Booking PraktiQu')

@push('head')
<script>
// Payload tenant dari resolveTenant server-side + logika wizard booking —
// port dari lib/useBooking.js FE lama. Token & snapshot pembayaran disimpan
// di sessionStorage (kunci sama: pq_pay_token / pq_pay_snapshot) supaya
// layar sukses + status pembayaran pulih setelah kembali dari checkout.
window.bookingApp = function () {
  const tenant = @json($tenant);
  const ADMIN = {{ $adminFee }};
  const STEPS = 6;
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const titles = ["Pilih Layanan", "Atur Jadwal", "Data Diri", "Detail Keluhan", "Ringkasan Booking", "Pembayaran"];
  const subtitles = [
    "Pilih jenis layanan dan tipe sesi yang paling sesuai dengan kebutuhan Anda.",
    "Tentukan tanggal dan waktu sesi yang nyaman bagi Anda.",
    "Lengkapi data diri untuk pengiriman konfirmasi sesi.",
    "Bagikan keluhan Anda agar psikolog dapat mempersiapkan sesi.",
    "Periksa kembali detail booking Anda sebelum membayar.",
    "Pilih metode pembayaran untuk menyelesaikan booking.",
  ];
  const payments = [
    { id: "va", name: "Virtual Account", desc: "BCA, Mandiri, BNI, BRI", code: "VA", bg: "#ECEFFB", fg: "#425FAD" },
    { id: "ewallet", name: "E-Wallet", desc: "GoPay, OVO, DANA, ShopeePay", code: "EW", bg: "#EDEAF5", fg: "#6A52A8" },
    { id: "qris", name: "QRIS", desc: "Scan dari semua aplikasi pembayaran", code: "QR", bg: "#FBF0E2", fg: "#C58A2E" },
  ];
  const PAY_TOKEN_KEY = "pq_pay_token";
  const PAY_SNAP_KEY = "pq_pay_snapshot";
  const TONE = {
    paid:      { bg: "#EAF7EF", fg: "#1B7F4B", label: "Pembayaran lunas", note: "Terima kasih, pembayaran Anda sudah kami terima." },
    pending:   { bg: "#FFF6E5", fg: "#9A6B00", label: "Menunggu pembayaran", note: "Selesaikan pembayaran di halaman checkout. Status di sini akan ikut berubah otomatis." },
    failed:    { bg: "#FDECEC", fg: "#B3261E", label: "Pembayaran gagal", note: "Pembayaran tidak berhasil diproses. Silakan coba lagi." },
    expired:   { bg: "#FDECEC", fg: "#B3261E", label: "Pembayaran kedaluwarsa", note: "Batas waktu pembayaran habis. Silakan mulai ulang pembayaran." },
    cancelled: { bg: "#F2F3F7", fg: "#5A5F7A", label: "Pembayaran dibatalkan", note: "Pembayaran dibatalkan. Anda masih bisa mencoba lagi." },
  };

  const buildDates = () => {
    const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    const mon = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
    const out = [];
    const base = new Date(); base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      out.push({ iso: d.toISOString().slice(0, 10), day: days[d.getDay()], num: String(d.getDate()), mon: mon[d.getMonth()], full: days[d.getDay()] + ", " + d.getDate() + " " + mon[d.getMonth()] });
    }
    return out;
  };

  const post = async (url, body) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-TOKEN": csrf }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error((json && json.message) || "HTTP " + res.status);
    return json;
  };

  return {
    tenant, ADMIN, STEPS, titles, subtitles, payments, TONE,
    services: tenant.services || [],
    psy: tenant.psy,
    rawDates: buildDates(),
    slotCache: {},
    started: false, step: 0, mode: "online", serviceId: null, dateIso: null, time: null,
    name: "", email: "", whatsapp: "", complaint: "", prevConsult: null, fileName: null, payId: null, code: null,
    submitting: false, submitError: null,
    payToken: null, payStatus: null, paying: false, payError: null, pollId: null, copied: false,

    init() {
      // Kembali dari checkout: pulihkan token + layar sukses (state hilang
      // karena checkout adalah navigasi keluar).
      let stored = null, snap = null;
      try { stored = sessionStorage.getItem(PAY_TOKEN_KEY); snap = JSON.parse(sessionStorage.getItem(PAY_SNAP_KEY) || "null"); } catch {}
      if (stored) {
        this.payToken = stored;
        if (snap) Object.assign(this, snap);
        this.started = true; this.step = STEPS;
        this.checkPayment();
      }
      this.$watch("payStatus", () => this.managePolling());
    },

    // ── derived ──
    get isSuccess() { return this.step === STEPS; },
    get servicesEmpty() { return this.services.length === 0; },
    get svc() { return this.services.find((x) => x.id === this.serviceId) || null; },
    get price() { return this.svc ? this.svc.price : this.psy.price; },
    get total() { return this.price + ADMIN; },
    get dates() { return this.rawDates.map((d) => ({ ...d, bookable: this.slotCache[d.iso] ? this.slotCache[d.iso].length > 0 : true })); },
    get timesForDate() { return this.slotCache[this.dateIso] || []; },
    get dateObj() { return this.rawDates.find((d) => d.iso === this.dateIso) || null; },
    get modeLabel() { return this.mode === "online" ? "Online · Video Call" : "Tatap Muka · Klinik"; },
    get schedLabel() { return this.dateObj ? this.dateObj.full + " · " + (this.time || "") : "—"; },
    get valid() {
      if (this.submitting || this.servicesEmpty) return false;
      switch (this.step) {
        case 0: return !!this.serviceId;
        case 1: return !!this.dateIso && !!this.time;
        case 2: return this.name.trim() && /.+@.+\..+/.test(this.email) && this.whatsapp.trim().length >= 6;
        case 3: case 4: return true;
        case 5: return !!this.payId;
        default: return false;
      }
    },
    get btnLabel() { return this.step === 4 ? "Lanjut ke Pembayaran" : this.step === 5 ? "Bayar Sekarang" : "Lanjutkan ›"; },
    fmt(n) { return "Rp " + Number(n).toLocaleString("id-ID"); },
    stepState(i) { const cur = this.isSuccess ? STEPS : this.step; return cur > i ? "done" : cur === i ? "active" : "todo"; },

    // ── actions ──
    async pickDate(iso) {
      this.dateIso = iso; this.time = null;
      if (this.slotCache[iso] || !this.psy.apiId) return;
      try {
        const res = await fetch(`/booking/slots?professionalId=${encodeURIComponent(this.psy.apiId)}&date=${iso}`, { headers: { "Accept": "application/json" } });
        const json = await res.json();
        this.slotCache = { ...this.slotCache, [iso]: json.times || [] };
      } catch { this.slotCache = { ...this.slotCache, [iso]: [] }; }
    },
    start() { this.started = true; },
    back() { if (this.step === 0) this.started = false; else if (this.step > 0 && this.step < STEPS) this.step--; },
    goStepBack(n) { if (n <= this.step && this.step < STEPS) this.step = n; },
    async next() {
      if (!this.valid) return;
      this.submitError = null;
      if (this.step === STEPS - 1) {
        this.submitting = true;
        try {
          const res = await post("/booking/submit", {
            professionalId: this.psy.apiId, serviceId: this.svc.apiId, date: this.dateIso, startTime: this.time,
            clientName: this.name, clientEmail: this.email, clientMobile: this.whatsapp,
            notes: this.complaint ? this.complaint.slice(0, 1000) : null,
          });
          this.code = res.code; this.step = STEPS;
          if (res.token) {
            this.payToken = res.token;
            try {
              sessionStorage.setItem(PAY_TOKEN_KEY, res.token);
              sessionStorage.setItem(PAY_SNAP_KEY, JSON.stringify({ code: res.code, serviceId: this.serviceId, dateIso: this.dateIso, time: this.time, mode: this.mode }));
            } catch {}
            this.checkPayment();
          }
        } catch (e) {
          this.submitError = e.message || "Booking gagal. Silakan coba lagi.";
        } finally { this.submitting = false; }
      } else this.step++;
    },
    reset() {
      this.started = false; this.step = 0; this.mode = "online"; this.serviceId = null; this.dateIso = null; this.time = null;
      this.name = ""; this.email = ""; this.whatsapp = ""; this.complaint = ""; this.prevConsult = null; this.fileName = null; this.payId = null; this.code = null;
      this.submitError = null; this.payToken = null; this.payStatus = null; this.payError = null;
      try { sessionStorage.removeItem(PAY_TOKEN_KEY); sessionStorage.removeItem(PAY_SNAP_KEY); } catch {}
    },

    // ── pembayaran: status ditulis webhook; redirect browser bukan bukti bayar,
    // jadi poll verify sampai final. 409 = order pending sudah ada. ──
    async checkPayment() {
      if (!this.payToken) return;
      try {
        const view = await post("/booking/verify", { token: this.payToken });
        if (view && view.status) this.payStatus = view;
      } catch {}
    },
    managePolling() {
      if (this.payToken && this.payStatus && this.payStatus.status === "pending" && !this.pollId) {
        this.pollId = setInterval(() => this.checkPayment(), 5000);
      } else if ((!this.payStatus || this.payStatus.status !== "pending") && this.pollId) {
        clearInterval(this.pollId); this.pollId = null;
      }
    },
    // Status di luar daftar TONE (backend menambah kode baru) tetap ditampilkan
    // apa adanya dengan warna netral — lebih baik daripada badge hilang diam-diam.
    get payTone() {
      if (!this.payStatus) return null;
      return this.TONE[this.payStatus.status]
        || { bg: "#F2F3F7", fg: "#5A5F7A", label: this.payStatus.status, note: "Status pembayaran terbaru dari sistem." };
    },
    get canPay() { return !this.payStatus || ["failed", "expired", "cancelled"].includes(this.payStatus.status); },
    // Kode booking sering berupa token bertandatangan yang panjang. Untuk
    // tampilan cukup dipendekkan (awal…akhir); nilai penuh tetap bisa disalin.
    get codeShort() { const c = this.code || ""; return c.length > 22 ? c.slice(0, 12) + "…" + c.slice(-6) : c; },
    async copyCode() {
      const text = this.code || "";
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch {}
      if (!ok) {
        // Fallback untuk konteks tanpa Clipboard API (browser lama / non-HTTPS).
        try {
          const ta = document.createElement("textarea");
          ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
          document.body.appendChild(ta); ta.focus(); ta.select();
          ok = document.execCommand("copy");
          document.body.removeChild(ta);
        } catch {}
      }
      if (ok) { this.copied = true; setTimeout(() => { this.copied = false; }, 1800); }
    },
    async pay() {
      if (!this.payToken || this.paying) return;
      this.paying = true; this.payError = null;
      try {
        const res = await post("/booking/pay", { token: this.payToken });
        // Hanya arahkan ke checkout kalau URL-nya ABSOLUT (http/https). Kalau
        // backend mengirim path relatif/aneh, `window.location.href` akan
        // menyelesaikannya ke origin FE dan mendarat di /booking/pay (GET) →
        // 405. Jadi tolak yang bukan URL absolut.
        if (res.checkoutUrl && /^https?:\/\//i.test(res.checkoutUrl)) {
          window.location.href = res.checkoutUrl;
        } else if (res.checkoutUrl) {
          console.warn("[pay] checkoutUrl bukan URL absolut:", res.checkoutUrl);
          this.payError = "Tautan pembayaran dari server tidak valid. Hubungi admin.";
        } else if (res.pending) {
          await this.checkPayment();
          if (!this.payStatus) this.payStatus = { status: "pending", expectedAmount: this.total };
        }
      } catch (e) {
        this.payError = e.message || "Gagal membuka halaman pembayaran.";
      } finally { this.paying = false; }
    },
  };
};
</script>
@endpush

@section('content')
<div class="bk-wrap" x-data="bookingApp()" x-cloak>

  {{-- ═══ LAYAR PEMBUKA ═══ --}}
  <template x-if="!started">
    <div class="bk-card">
      <div class="bk-side" style="width:420px;padding:48px 42px">
        <div class="logo-chip"><img src="/praktiqu-logo.png" alt="PraktiQu" style="height:24px;width:auto"></div>
        <div class="bk-side-detail" style="flex:1;display:flex;flex-direction:column;justify-content:center">
          <div class="avatar" :style="`width:92px;height:92px;border-radius:26px;font-size:32px;background:${psy.c};box-shadow:0 14px 30px -10px rgba(0,0,0,.4)`" x-text="psy.init"></div>
          <div style="font-family:'Newsreader',serif;font-size:28px;font-weight:600;color:#fff;margin-top:22px;line-height:1.25" x-text="psy.name"></div>
          <div style="font-size:14px;color:#AAB4DC;margin-top:8px;line-height:1.5" x-text="psy.spec"></div>
          <div style="display:flex;flex-wrap:wrap;gap:9px;margin-top:22px">
            <template x-for="f in psy.focus" :key="f"><span class="dark-pill" x-text="f"></span></template>
          </div>
        </div>
        <div class="bk-side-detail" style="border-top:1px solid rgba(255,255,255,.12);padding-top:22px">
          <div style="display:flex;align-items:center;gap:8px;color:#8B95C0;font-size:12.5px"><span>🔒</span> Data Anda rahasia &amp; aman</div>
        </div>
      </div>

      <div class="bk-main">
        <div style="padding:32px 48px 0;display:flex;justify-content:flex-end">
          <a href="/" style="display:inline-flex;align-items:center;gap:7px;background:#ECEFFB;color:#425FAD;font-size:13px;font-weight:600;padding:9px 15px;border-radius:10px;text-decoration:none">Masuk sebagai Admin / Psikolog →</a>
        </div>
        <div class="bk-main-pad" style="flex:1;overflow-y:auto;padding:24px 48px;display:flex;flex-direction:column;justify-content:center">
          <div style="display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;color:#425FAD;letter-spacing:.06em;text-transform:uppercase">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:8px;background:#ECEFFB;font-size:11px;font-weight:800;letter-spacing:0" x-text="tenant.init"></span>
            <span x-text="tenant.name"></span>
          </div>
          <div style="font-family:'Newsreader',serif;font-size:34px;font-weight:500;color:#1E2236;margin-top:12px;line-height:1.2">Halo, mari kita mulai langkah pertamamu.</div>
          <div style="font-size:15px;color:#4A4F6B;line-height:1.7;margin-top:18px;max-width:520px" x-text="psy.bio"></div>
        </div>
        <div class="bk-foot-pad" style="flex:none;padding:22px 48px 28px;border-top:1px solid #F0F2F8;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">
          <div>
            <div style="font-size:12.5px;color:#9BA0B8">Biaya konsultasi mulai dari</div>
            <div style="font-size:22px;font-weight:800;color:#425FAD;margin-top:2px"><span x-text="fmt(price)"></span><span style="font-size:13px;font-weight:500;color:#9BA0B8">/sesi</span></div>
          </div>
          <button @click="start()" style="padding:16px 40px;border-radius:14px;border:none;font-size:15.5px;font-weight:700;cursor:pointer;background:#425FAD;color:#fff;box-shadow:0 10px 24px -8px rgba(66,95,173,.6)">Buat Janji Temu ›</button>
        </div>
      </div>
    </div>
  </template>

  {{-- ═══ WIZARD ═══ --}}
  <template x-if="started">
    <div class="bk-card">
      {{-- SIDEBAR LANGKAH --}}
      <div class="bk-side" style="width:372px;padding:42px 38px">
        <div style="display:flex;align-items:center;gap:12px">
          <div class="logo-chip"><img src="/praktiqu-logo.png" alt="PraktiQu" style="height:22px;width:auto"></div>
          <div style="font-size:14px;font-weight:700;color:#AAB4DC;letter-spacing:-.01em">Appointment</div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:24px;background:rgba(255,255,255,.07);border-radius:14px;padding:13px">
          <div class="avatar" :style="`width:42px;height:42px;border-radius:12px;font-size:15px;background:${psy.c}`" x-text="psy.init"></div>
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" x-text="psy.name"></div>
            <div style="font-size:12px;color:#AAB4DC;margin-top:1px" x-text="psy.spec"></div>
          </div>
        </div>
        <div class="bk-side-detail" style="margin-top:30px;display:flex;flex-direction:column;gap:4px;flex:1">
          <template x-for="(t, i) in titles" :key="i">
            <div class="step-row" :class="stepState(i)" @click="goStepBack(i)">
              <div class="step-circle"><span x-show="stepState(i) === 'done'">✓</span><span x-show="stepState(i) !== 'done'" x-text="i + 1"></span></div>
              <div class="step-lbl" x-text="t"></div>
            </div>
          </template>
        </div>
        <div class="bk-side-detail" style="border-top:1px solid rgba(255,255,255,.12);padding-top:22px;margin-top:22px">
          <div style="font-family:'Newsreader',serif;font-size:16px;font-style:italic;color:#AAB4DC;line-height:1.5">"Meminta bantuan adalah tanda kekuatan, bukan kelemahan."</div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:16px;color:#8B95C0;font-size:12.5px"><span>🔒</span> Data Anda rahasia &amp; aman</div>
        </div>
      </div>

      {{-- KONTEN --}}
      <div class="bk-main">
        <div class="bk-head-pad" x-show="!isSuccess" style="padding:40px 48px 22px;border-bottom:1px solid #F0F2F8">
          <div style="font-size:12.5px;font-weight:600;color:#425FAD;letter-spacing:.05em;text-transform:uppercase">Langkah <span x-text="step + 1"></span> dari <span x-text="STEPS"></span></div>
          <div style="font-size:27px;font-weight:700;color:#1E2236;margin-top:5px" x-text="titles[step] || ''"></div>
          <div style="font-size:14px;color:#6B7090;margin-top:6px" x-text="subtitles[step] || ''"></div>
        </div>

        <div class="bk-main-pad" style="flex:1;overflow-y:auto;padding:24px 48px 30px">

          {{-- Langkah 0: layanan --}}
          <div x-show="step === 0" class="anim-rtup">
            <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap">
              <span style="font-size:13.5px;font-weight:600;color:#4A4F6B">Tipe sesi:</span>
              <div style="display:flex;background:#F0F2F8;border-radius:13px;padding:4px;gap:4px">
                <button class="mode-pill" :class="{ active: mode === 'online' }" @click="mode = 'online'">Online · Video Call</button>
                <button class="mode-pill" :class="{ active: mode === 'offline' }" @click="mode = 'offline'">Tatap Muka</button>
              </div>
            </div>
            <div x-show="servicesEmpty" style="padding:22px;border:1px solid #E6E9F2;border-radius:13px;background:#FBFCFE;text-align:center">
              <div style="font-size:15px;font-weight:700;color:#1E2236">Layanan belum tersedia</div>
              <div style="font-size:13px;color:#6B7090;margin-top:6px;line-height:1.5">Kami belum bisa memuat daftar layanan klinik ini. Coba muat ulang halaman, atau hubungi klinik untuk memesan langsung.</div>
            </div>
            <div class="grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <template x-for="x in services" :key="x.id">
                <div class="svc-card" :class="{ sel: x.id === serviceId }" @click="serviceId = x.id">
                  <div style="flex:1">
                    <div style="font-size:16px;font-weight:700;color:#1E2236" x-text="x.name"></div>
                    <div style="font-size:13px;color:#6B7090;margin-top:5px;line-height:1.5" x-text="x.desc"></div>
                    <div style="font-size:12.5px;color:#425FAD;font-weight:600;margin-top:10px" x-text="x.dur"></div>
                  </div>
                  <div class="radio"><div class="radio-dot" x-show="x.id === serviceId"></div></div>
                </div>
              </template>
            </div>
          </div>

          {{-- Langkah 1: jadwal --}}
          <div x-show="step === 1" class="anim-rtup">
            <div style="font-size:13.5px;font-weight:700;color:#1E2236;margin-bottom:12px">Pilih Tanggal</div>
            <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px">
              <template x-for="d in dates" :key="d.iso">
                <div class="date-card" :class="{ sel: d.iso === dateIso, off: !d.bookable }" @click="d.bookable && pickDate(d.iso)">
                  <div style="font-size:12px;font-weight:600;opacity:.7" x-text="d.day"></div>
                  <div style="font-size:20px;font-weight:700;margin:3px 0" x-text="d.num"></div>
                  <div style="font-size:11px;opacity:.7" x-text="d.mon"></div>
                </div>
              </template>
            </div>
            <div style="font-size:13.5px;font-weight:700;color:#1E2236;margin:26px 0 12px">Pilih Waktu</div>
            <div x-show="timesForDate.length === 0" style="font-size:13.5px;color:#9BA0B8" x-text="dateIso ? 'Tidak ada slot tersedia di tanggal ini.' : 'Pilih tanggal terlebih dahulu.'"></div>
            <div x-show="timesForDate.length > 0" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;max-width:560px">
              <template x-for="t in timesForDate" :key="t">
                <div class="time-card" :class="{ sel: t === time }" @click="time = t" x-text="t"></div>
              </template>
            </div>
          </div>

          {{-- Langkah 2: data diri --}}
          <div x-show="step === 2" class="anim-rtup grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:20px 22px;max-width:680px">
            <div style="grid-column:1 / -1">
              <label class="lbl" style="margin-bottom:8px">Nama Lengkap</label>
              <input class="inp inp-green" x-model="name" placeholder="Nama sesuai identitas">
            </div>
            <div>
              <label class="lbl" style="margin-bottom:8px">Email</label>
              <input class="inp inp-green" x-model="email" type="email" placeholder="nama@email.com">
            </div>
            <div>
              <label class="lbl" style="margin-bottom:8px">Nomor WhatsApp</label>
              <div class="fw-green" style="display:flex;align-items:stretch;border:1.5px solid #DDE1EC;border-radius:13px;overflow:hidden">
                <div style="display:flex;align-items:center;padding:0 14px;background:#F2F4FA;font-size:14.5px;font-weight:600;color:#4A4F6B;border-right:1.5px solid #DDE1EC">+62</div>
                <input x-model="whatsapp" type="tel" placeholder="812 3456 7890" style="flex:1;padding:14px 16px;border:none;font-size:14.5px;font-family:inherit;color:#1E2236;outline:none">
              </div>
            </div>
            <div style="grid-column:1 / -1;font-size:12.5px;color:#9BA0B8;margin-top:-6px">Konfirmasi &amp; link sesi akan dikirim ke email dan WhatsApp ini.</div>
          </div>

          {{-- Langkah 3: keluhan --}}
          <div x-show="step === 3" class="anim-rtup" style="display:flex;flex-direction:column;gap:22px;max-width:680px">
            <div>
              <label class="lbl" style="margin-bottom:8px">Ceritakan keluhan Anda</label>
              <textarea class="inp inp-green" x-model="complaint" placeholder="Apa yang sedang Anda rasakan akhir-akhir ini? Sejak kapan? (opsional, tapi membantu psikolog mempersiapkan sesi)" style="min-height:130px;resize:none;line-height:1.55;font-size:14px"></textarea>
            </div>
            <div class="grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start">
              <div>
                <label class="lbl" style="margin-bottom:10px">Pernah konsultasi sebelumnya?</label>
                <div style="display:flex;gap:10px">
                  <button class="choice-pill" :class="{ active: prevConsult === 'yes' }" @click="prevConsult = 'yes'">Pernah</button>
                  <button class="choice-pill" :class="{ active: prevConsult === 'no' }" @click="prevConsult = 'no'">Belum pernah</button>
                </div>
              </div>
              <div>
                <label class="lbl" style="margin-bottom:10px">Lampiran (opsional)</label>
                <label :style="`display:flex;align-items:center;gap:13px;padding:13px 15px;border-radius:14px;border:1.5px dashed ${fileName ? '#425FAD' : '#C8CDDE'};background:${fileName ? '#ECEFFB' : '#fff'};cursor:pointer`">
                  <input type="file" @change="fileName = $event.target.files && $event.target.files[0] ? $event.target.files[0].name : null" style="display:none">
                  <div style="width:38px;height:38px;border-radius:10px;background:#ECEFFB;display:flex;align-items:center;justify-content:center;font-size:18px;color:#425FAD;flex:none">⊕</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13.5px;font-weight:600;color:#1E2236;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" x-text="fileName || 'Unggah file'"></div>
                    <div style="font-size:11.5px;color:#9BA0B8">Diagnosis / rujukan · PDF, JPG</div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {{-- Langkah 4: ringkasan --}}
          <div x-show="step === 4" class="anim-rtup grid-2col" style="display:grid;grid-template-columns:1.4fr 1fr;gap:18px;align-items:start">
            <div style="background:#fff;border:1.5px solid #DDE1EC;border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:16px">
              <div style="display:flex;align-items:center;gap:14px">
                <div class="avatar" :style="`width:46px;height:46px;border-radius:13px;font-size:15px;background:${psy.c}`" x-text="psy.init"></div>
                <div style="flex:1"><div style="font-size:15.5px;font-weight:700;color:#1E2236" x-text="psy.name"></div><div style="font-size:12.5px;color:#6B7090;margin-top:2px" x-text="psy.spec"></div></div>
              </div>
              <div style="height:1px;background:#F0F2F8"></div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between">
                <div><div style="font-size:11.5px;color:#9BA0B8">Layanan</div><div style="font-size:14px;font-weight:600;color:#1E2236;margin-top:2px"><span x-text="svc ? svc.name : '—'"></span> · <span x-text="modeLabel"></span></div></div>
                <button @click="goStepBack(0)" style="font-size:12.5px;font-weight:600;color:#425FAD;background:none;border:none;cursor:pointer">Ubah</button>
              </div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between">
                <div><div style="font-size:11.5px;color:#9BA0B8">Jadwal</div><div style="font-size:14px;font-weight:600;color:#1E2236;margin-top:2px" x-text="schedLabel"></div></div>
                <button @click="goStepBack(1)" style="font-size:12.5px;font-weight:600;color:#425FAD;background:none;border:none;cursor:pointer">Ubah</button>
              </div>
              <div style="display:flex;align-items:flex-start;justify-content:space-between">
                <div><div style="font-size:11.5px;color:#9BA0B8">Atas Nama</div><div style="font-size:14px;font-weight:600;color:#1E2236;margin-top:2px" x-text="name || '—'"></div><div style="font-size:12.5px;color:#6B7090;margin-top:1px">+62 <span x-text="whatsapp || '—'"></span></div></div>
                <button @click="goStepBack(2)" style="font-size:12.5px;font-weight:600;color:#425FAD;background:none;border:none;cursor:pointer">Ubah</button>
              </div>
            </div>
            <div style="background:#F2F4FA;border:1.5px solid #DDE1EC;border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:13px">
              <div style="font-size:13.5px;font-weight:700;color:#1E2236;margin-bottom:2px">Rincian Biaya</div>
              <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#4A4F6B"><span>Biaya layanan</span><span x-text="fmt(price)"></span></div>
              <div style="display:flex;justify-content:space-between;font-size:13.5px;color:#4A4F6B"><span>Biaya admin</span><span x-text="fmt(ADMIN)"></span></div>
              <div style="height:1px;background:#E6E9F1"></div>
              <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:15px;font-weight:700;color:#1E2236">Total</span><span style="font-size:21px;font-weight:800;color:#425FAD" x-text="fmt(total)"></span></div>
            </div>
          </div>

          {{-- Langkah 5: pembayaran --}}
          <div x-show="step === 5" class="anim-rtup pay-grid">
            <div>
              <div style="font-size:13.5px;font-weight:700;color:#1E2236;margin-bottom:11px">Metode Pembayaran</div>
              <div style="display:flex;flex-direction:column;gap:10px">
                <template x-for="m in payments" :key="m.id">
                  <div class="pay-card" :class="{ sel: m.id === payId }" @click="payId = m.id">
                    <div :style="`width:42px;height:42px;border-radius:11px;flex:none;background:${m.bg};color:${m.fg};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800`" x-text="m.code"></div>
                    <div style="flex:1"><div style="font-size:14.5px;font-weight:700;color:#1E2236" x-text="m.name"></div><div style="font-size:12px;color:#6B7090;margin-top:2px" x-text="m.desc"></div></div>
                    <div class="radio"><div class="radio-dot" x-show="m.id === payId"></div></div>
                  </div>
                </template>
              </div>
            </div>
            <div style="background:#1E2A52;border-radius:16px;padding:18px 20px;display:flex;flex-direction:column;gap:11px">
              <div style="font-size:13px;color:#AAB4DC;font-weight:600">Ringkasan Pembayaran</div>
              <div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;color:#AAB4DC"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" x-text="svc ? svc.name : '—'"></span><span style="flex:none" x-text="fmt(price)"></span></div>
              <div style="display:flex;justify-content:space-between;font-size:13px;color:#AAB4DC"><span>Biaya admin</span><span x-text="fmt(ADMIN)"></span></div>
              <div style="height:1px;background:rgba(255,255,255,.14)"></div>
              <div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:14px;font-weight:600;color:#fff">Total</span><span style="font-size:21px;font-weight:800;color:#fff" x-text="fmt(total)"></span></div>
              <div style="display:flex;align-items:center;gap:8px;color:#8B95C0;font-size:12px;margin-top:2px"><span>🔒</span> Aman &amp; terenkripsi</div>
            </div>
          </div>

          {{-- Sukses + panel pembayaran --}}
          <div x-show="isSuccess" style="animation:rtup .4s ease;display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:14px;min-height:100%;justify-content:center">
            <div style="width:96px;height:96px;border-radius:99px;background:#425FAD;display:flex;align-items:center;justify-content:center;animation:rtpop .5s cubic-bezier(.2,.8,.3,1.2);box-shadow:0 14px 34px -8px rgba(66,95,173,.5)">
              <span style="color:#fff;font-size:48px;line-height:1;font-weight:300">✓</span>
            </div>
            <div style="font-family:'Newsreader',serif;font-size:32px;font-weight:500;color:#1E2236;margin-top:24px">Booking Berhasil</div>
            <div style="font-size:14.5px;color:#6B7090;margin-top:8px;line-height:1.5;max-width:420px">Konfirmasi &amp; link sesi telah dikirim ke email dan WhatsApp Anda. Sampai bertemu di sesi nanti — jaga diri ya.</div>
            {{-- Satu kartu terpadu: detail sesi → kode booking ringkas →
                 pembayaran. Menggantikan dua kotak terpisah + panel yang dulu
                 berserakan dan token panjangnya meluber ke seluruh layar. --}}
            <div style="width:100%;max-width:440px;margin-top:26px;background:#fff;border:1.5px solid #DDE1EC;border-radius:18px;overflow:hidden;text-align:left;box-shadow:0 4px 18px -12px rgba(30,42,82,.3)">
              {{-- Detail sesi --}}
              <div style="display:flex;align-items:center;gap:14px;padding:18px 20px">
                <div class="avatar" :style="`width:46px;height:46px;border-radius:13px;font-size:15px;background:${psy.c}`" x-text="psy.init"></div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:14.5px;font-weight:700;color:#1E2236" x-text="psy.name"></div>
                  <div style="font-size:12.5px;color:#6B7090;margin-top:2px" x-text="schedLabel"></div>
                </div>
              </div>

              {{-- Kode booking: ringkas (awal…akhir), lengkap saat disalin --}}
              <div x-show="code" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid #F0F2F8;background:#F7F8FB">
                <div style="min-width:0">
                  <div style="font-size:11px;color:#9BA0B8;letter-spacing:.05em">KODE BOOKING</div>
                  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;font-weight:600;color:#425FAD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px" x-text="codeShort"></div>
                </div>
                <button @click="copyCode()" style="flex:none;border:1px solid #DDE1EC;background:#fff;color:#425FAD;font-size:12px;font-weight:700;padding:7px 13px;border-radius:9px;cursor:pointer;font-family:inherit" x-text="copied ? 'Tersalin ✓' : 'Salin'"></button>
              </div>

              {{-- Pembayaran --}}
              <div x-show="payToken" style="padding:16px 20px 18px;border-top:1px solid #F0F2F8">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                  <div>
                    <div style="font-size:11px;color:#9BA0B8;letter-spacing:.05em">TOTAL PEMBAYARAN</div>
                    <div style="font-size:19px;font-weight:800;color:#1E2236;margin-top:3px" x-text="fmt((payStatus && payStatus.expectedAmount) || total)"></div>
                  </div>
                  <div x-show="payTone" :style="payTone ? `background:${payTone.bg};color:${payTone.fg};font-size:12px;font-weight:700;padding:7px 12px;border-radius:99px;white-space:nowrap` : ''" x-text="payTone ? payTone.label : ''"></div>
                </div>
                <div style="font-size:12.5px;color:#6B7090;margin-top:8px;line-height:1.5" x-text="payTone ? payTone.note : 'Selesaikan pembayaran untuk mengunci jadwal sesi Anda.'"></div>
                <div x-show="payError" style="background:#FDECEC;color:#B3261E;font-size:12.5px;padding:10px 12px;border-radius:10px;margin-top:12px;line-height:1.5" x-text="payError"></div>
                <button x-show="canPay" @click="pay()" :disabled="paying"
                  :style="`width:100%;margin-top:14px;padding:13px 24px;border-radius:12px;border:none;background:${paying ? '#9BA6CB' : '#425FAD'};color:#fff;font-size:14.5px;font-weight:700;cursor:${paying ? 'default' : 'pointer'}`"
                  x-text="paying ? 'Membuka pembayaran…' : (payStatus ? 'Coba Bayar Lagi' : 'Bayar Sekarang')"></button>
              </div>
            </div>
          </div>

        </div>

        {{-- FOOTER --}}
        <div class="bk-foot-pad" x-show="!isSuccess" style="flex:none;padding:20px 48px 26px;border-top:1px solid #F0F2F8;display:flex;align-items:center;justify-content:space-between;gap:12px">
          <button class="btn-back" @click="back()">‹ Kembali</button>
          <div x-show="submitError" style="flex:1;text-align:center;color:#B3261E;font-size:12.5px;font-weight:600" x-text="submitError"></div>
          <button class="btn-next" :disabled="!valid" @click="next()" x-text="submitting ? 'Mengirim…' : btnLabel"></button>
        </div>
        <div class="bk-foot-pad" x-show="isSuccess" style="flex:none;padding:20px 48px 26px;border-top:1px solid #F0F2F8;display:flex;justify-content:center;gap:12px">
          <button @click="reset()" style="padding:14px 32px;border-radius:14px;border:1.5px solid #DDE1EC;background:#fff;color:#4A4F6B;font-size:15px;font-weight:700;cursor:pointer">Booking Lagi</button>
          <button @click="reset()" style="padding:14px 48px;border-radius:14px;border:none;background:#425FAD;color:#fff;font-size:15px;font-weight:700;cursor:pointer">Selesai &amp; Keluar</button>
        </div>
      </div>
    </div>
  </template>
</div>
@endsection
