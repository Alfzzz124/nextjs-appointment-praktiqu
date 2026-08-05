@extends('layouts.base')
@section('title', 'Dashboard — PraktiQu')

@push('head')
<script>
// Port components/dashboard/DashboardApp.js: data dimuat server-side oleh
// DashboardController lalu diserahkan ke Alpine — perpindahan view, pencarian,
// tab, toggle, dan form "Tambah" tetap berjalan di klien persis seperti
// versi React (aksi tambah/hapus/toggle bersifat lokal, belum menulis ke API,
// kecuali unggah foto yang diteruskan ke backend).
window.dashApp = function () {
  const payload = JSON.parse(document.getElementById('dash-payload').textContent);
  const csrf = document.querySelector('meta[name="csrf-token"]').content;
  const AVATAR = ["#7A8AD0", "#C58A2E", "#8A6BB0", "#3B7CA8", "#1F8A5B", "#C56A6A", "#425FAD"];
  const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const pickColor = () => AVATAR[Math.floor(Math.random() * AVATAR.length)];
  const initialsOf = (n) => (n || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
  const todayStr = () => { const d = new Date(); return `${d.getDate()} ${monthsId[d.getMonth()]} ${d.getFullYear()}`; };
  const todayIso = () => new Date().toISOString().slice(0, 10);
  const idDate = (iso) => { if (!iso) return "—"; const d = new Date(iso + "T00:00:00"); return `${d.getDate()} ${monthsId[d.getMonth()]} ${d.getFullYear()}`; };

  const NAV = {
    dashboard: "Dashboard", appointments: "Appointments", encounters: "Encounters", patients: "Patients",
    doctors: "Doctors", receptionists: "Receptionists", clinics: "Clinics", services: "Services",
    sessions: "Doctor Sessions", billing: "Billing Records", reports: "Reports", settings: "Settings", features: "Request Features",
  };
  const SECTIONS = [
    { title: "Main", items: ["dashboard", "appointments", "encounters"] },
    { title: "Users", items: ["patients", "doctors", "receptionists"] },
    { title: "Clinic", items: ["clinics", "services", "sessions"] },
    { title: "Financial", items: ["billing", "reports"] },
    { title: "Settings", items: ["settings"] },
    { title: "Support", items: ["features"] },
  ];
  const REAL = ["dashboard", "appointments", "patients", "doctors", "billing", "services", "sessions", "reports", "settings", "encounters", "receptionists", "clinics", "features"];
  const ROLE_ALLOWED = {
    super: REAL,
    admin: ["dashboard", "appointments", "encounters", "patients", "services", "sessions", "billing", "settings"],
    psikolog: ["dashboard", "appointments", "encounters", "patients", "sessions", "reports", "settings"],
  };
  const STAT_KEYS = {
    super: ["appointments", "patients", "clinics", "doctors", "services", "revenue"],
    admin: ["appointments", "patients", "services", "revenue"],
    psikolog: ["appointments", "patients", "services", "revenue"],
  };
  const STAT_META = {
    appointments: { label: "Total Appointments", green: false },
    patients: { label: "Total Patients", green: false },
    clinics: { label: "Total Clinics", green: false },
    doctors: { label: "Total Doctors", green: false },
    services: { label: "Active Services", green: false },
    revenue: { label: "Total Revenue", green: true },
  };
  const OVERVIEW_SUB = {
    super: "Ringkasan performa seluruh platform",
    admin: "Ringkasan performa klinik Anda",
    psikolog: "Ringkasan praktik Anda",
  };
  // Entitas yang aksi tambah/hapus/status-nya benar-benar ditulis ke backend
  // /api/v1 (lewat ResourceController). Sisanya (services, nonRegular, holidays)
  // masih lokal karena endpoint-nya butuh relasi id yang belum tersedia di form.
  const API_RESOURCES = ["patients", "doctors", "receptionists", "billing", "clinics", "sessions"];
  const dayLabels = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];
  const periods = [
    { id: "today", label: "Hari Ini" }, { id: "week", label: "Minggu Ini" },
    { id: "month", label: "Bulan Ini" }, { id: "year", label: "Tahun Ini" },
  ];
  const settingsTabList = [
    { id: "clinic", label: "Profil Klinik" }, { id: "account", label: "Akun & Keamanan" },
    { id: "notif", label: "Notifikasi" }, { id: "payment", label: "Pembayaran" }, { id: "team", label: "Tim & Akses" },
  ];

  // Konfigurasi form "Tambah" — sama dengan addConfigs di DashboardApp.js.
  const addConfigs = {
    patient: { title: "Tambah Pasien", list: "patients", fields: [
      { key: "name", label: "Nama Lengkap", required: true }, { key: "email", label: "Email", required: true },
      { key: "mobile", label: "No. HP" }, { key: "clinic", label: "Klinik", default: "—" } ],
      build: (f) => ({ initial: initialsOf(f.name), name: f.name, email: f.email, clinic: f.clinic || "—", clinicTag: !!f.clinic && f.clinic !== "—", mobile: f.mobile || "—", reg: todayStr(), active: true, color: pickColor() }) },
    doctor: { title: "Tambah Dokter", list: "doctors", fields: [
      { key: "name", label: "Nama", required: true }, { key: "email", label: "Email", required: true },
      { key: "mobile", label: "No. HP" }, { key: "clinic", label: "Klinik" },
      { key: "spec", label: "Spesialisasi", type: "select", options: ["Psikolog", "Konselor", "Coach", "Terapis Edukasi"] } ],
      build: (f) => ({ initial: initialsOf(f.name), name: f.name, email: f.email, clinic: f.clinic, mobile: f.mobile || "—", spec: f.spec, active: true, color: pickColor() }) },
    service: { title: "Tambah Layanan", list: "services", fields: [
      { key: "name", label: "Nama Layanan", required: true }, { key: "clinic", label: "Klinik" },
      { key: "mode", label: "Mode", type: "select", options: ["Online", "Offline"] },
      { key: "duration", label: "Durasi", default: "60 mnt" }, { key: "price", label: "Harga", default: "Rp0", required: true } ],
      build: (f) => ({ name: f.name, clinic: f.clinic, mode: f.mode, duration: f.duration, price: f.price, color: pickColor() }) },
    bill: { title: "Tambah Tagihan", list: "billing", fields: [
      { key: "name", label: "Nama Pasien", required: true }, { key: "doctor", label: "Dokter" },
      { key: "service", label: "Layanan", required: true }, { key: "total", label: "Jumlah", default: "Rp0", required: true },
      { key: "status", label: "Status", type: "select", options: ["Belum Bayar", "Lunas"] } ],
      build: (f, lists) => ({ id: String(300 + lists.billing.length), initial: initialsOf(f.name), name: f.name, doctor: f.doctor, clinic: "—", date: todayStr(), service: f.service, discount: "Rp0", total: f.total, status: f.status, badge: f.status === "Lunas" ? "green" : "salmon", color: pickColor() }) },
    session: { title: "Tambah Sesi", list: "sessions", fields: [
      { key: "name", label: "Nama Psikolog", required: true }, { key: "clinic", label: "Klinik" },
      { key: "mode", label: "Mode", type: "select", options: ["Online", "Offline", "Online & Offline"] },
      { key: "activeDays", label: "Hari Praktik", type: "days", default: [true, true, true, true, true, false, false] },
      { key: "hours", label: "Jam Praktik", default: "09:00 - 17:00" }, { key: "capacity", label: "Kapasitas Slot", default: "20" } ],
      build: (f) => ({ initial: initialsOf(f.name), name: f.name, clinic: f.clinic, mode: f.mode, booked: 0, capacity: Number(f.capacity) || 20, status: "open", hours: f.hours, active: f.activeDays, color: pickColor() }) },
    sessionCustom: { title: "Tambah Jadwal Custom", list: "nonRegular", fields: [
      { key: "name", label: "Nama Psikolog", required: true }, { key: "clinic", label: "Klinik" },
      { key: "mode", label: "Mode", type: "select", options: ["Online", "Offline", "Online & Offline"] },
      { key: "date", label: "Tanggal", type: "date", required: true }, { key: "time", label: "Jam", default: "09:00", required: true },
      { key: "note", label: "Catatan", placeholder: "opsional" } ],
      build: (f) => ({ id: Date.now(), kind: "custom", initial: initialsOf(f.name), name: f.name, clinic: f.clinic, mode: f.mode, dateIso: f.date, date: idDate(f.date), time: f.time, note: f.note || "", color: pickColor() }) },
    sessionDadakan: { title: "Tambah Jadwal Dadakan", list: "nonRegular", fields: [
      { key: "name", label: "Nama Psikolog", required: true }, { key: "clinic", label: "Klinik" },
      { key: "mode", label: "Mode", type: "select", options: ["Online", "Offline", "Online & Offline"] },
      { key: "date", label: "Tanggal", type: "date", required: true, default: todayIso() },
      { key: "time", label: "Jam", default: "09:00", required: true }, { key: "note", label: "Catatan", placeholder: "mis. pengganti slot batal" } ],
      build: (f) => ({ id: Date.now(), kind: "dadakan", initial: initialsOf(f.name), name: f.name, clinic: f.clinic, mode: f.mode, dateIso: f.date, date: idDate(f.date), time: f.time, note: f.note || "", color: pickColor() }) },
    holiday: { title: "Tambah Jadwal Libur", list: "holidays", fields: [
      { key: "name", label: "Psikolog", required: true }, { key: "clinic", label: "Klinik" },
      { key: "date", label: "Tanggal", type: "date", required: true },
      { key: "jamMulai", label: "Jam Mulai", default: "00:00" }, { key: "jamSelesai", label: "Jam Selesai", default: "23:59" },
      { key: "note", label: "Keterangan", placeholder: "mis. Cuti tahunan" } ],
      build: (f) => ({ id: Date.now(), initial: initialsOf(f.name), name: f.name, clinic: f.clinic, dateIso: f.date, date: idDate(f.date), timeLabel: (f.jamMulai === "00:00" && f.jamSelesai === "23:59") ? "Sepanjang hari" : `${f.jamMulai} - ${f.jamSelesai}`, note: f.note || "", color: pickColor() }) },
    receptionist: { title: "Tambah Resepsionis", list: "receptionists", fields: [
      { key: "name", label: "Nama", required: true }, { key: "email", label: "Email", required: true },
      { key: "mobile", label: "No. HP" }, { key: "clinic", label: "Klinik" } ],
      build: (f) => ({ initial: initialsOf(f.name), name: f.name, email: f.email, clinic: f.clinic, mobile: f.mobile || "—", active: true, color: pickColor() }) },
    clinic: { title: "Tambah Klinik", list: "clinics", fields: [
      { key: "name", label: "Nama Klinik", required: true }, { key: "address", label: "Alamat" },
      { key: "phone", label: "Telepon" },
      { key: "ownerPhoto", label: "Foto Pemilik Klinik", type: "file", placeholder: "Pilih foto pemilik…" } ],
      build: (f) => ({ initial: initialsOf(f.name), name: f.name, address: f.address || "—", phone: f.phone || "—", ownerPhoto: f.ownerPhoto || "", doctors: 0, active: true, color: pickColor(), slug: (f.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") }) },
  };

  return {
    role: payload.role, profile: payload.profile, dataError: payload.dataError,
    stats: payload.stats, revenue: payload.revenue,
    appts: payload.appts, patients: payload.patients, doctors: payload.doctors,
    billing: payload.billing, services: [], encounters: payload.encounters,
    receptionists: payload.receptionists, clinics: payload.clinics, sessions: payload.sessions,
    nonRegular: [], holidays: [], featureReqs: [], featureForm: { title: "", desc: "" },
    NAV, SECTIONS, dayLabels, periods, settingsTabList, OVERVIEW_SUB, STAT_KEYS, STAT_META, addConfigs,
    view: "dashboard", period: "month", sessionTab: "reguler", settingsTab: "clinic",
    prefs: { emailNotif: true, waReminder: true, autoConfirm: false },
    search: "", modal: null, modalForm: {}, modalError: "", modalBusy: false,
    upload: { name: "", uploading: false, error: "", preview: "" },
    toast: "",

    get allowed() { return ROLE_ALLOWED[this.role] || ROLE_ALLOWED.admin; },
    get sections() { return SECTIONS.map((s) => ({ ...s, items: s.items.filter((id) => this.allowed.includes(id)) })).filter((s) => s.items.length); },
    get periodLabel() { return periods.find((p) => p.id === this.period).label; },
    go(id) { if (!this.allowed.includes(id)) return; this.view = id; this.search = ""; },
    showToast(m) { this.toast = m; setTimeout(() => { this.toast = ""; }, 2400); },

    match(obj, keys) { const q = this.search.trim().toLowerCase(); return !q || keys.some((k) => String(obj[k] || "").toLowerCase().includes(q)); },
    get fAppts() { return this.appts.filter((r) => this.match(r, ["name", "doctor", "clinic", "service", "status"])); },
    get fPatients() { return this.patients.filter((r) => this.match(r, ["name", "email", "mobile", "clinic"])); },
    get fDoctors() { return this.doctors.filter((r) => this.match(r, ["name", "email", "clinic", "spec"])); },
    get fBilling() { return this.billing.filter((r) => this.match(r, ["name", "doctor", "service", "id", "status"])); },
    get fServices() { return this.services.filter((r) => this.match(r, ["name", "clinic", "mode"])); },
    get fEncounters() { return this.encounters.filter((r) => this.match(r, ["name", "doctor", "type", "status"])); },
    get fReceptionists() { return this.receptionists.filter((r) => this.match(r, ["name", "email", "clinic"])); },
    get fClinics() { return this.clinics.filter((r) => this.match(r, ["name", "address", "phone"])); },

    get stat() {
      return this.stats || {
        appointments: String(this.appts.length), patients: String(this.patients.length),
        clinics: String(this.clinics.length), doctors: String(this.doctors.length),
        services: String(this.services.length), revenue: "—",
      };
    },
    get topSessions() { return [...this.sessions].sort((a, b) => b.booked - a.booked).slice(0, 3); },
    get topServices() {
      const cnt = {};
      this.billing.forEach((b) => { cnt[b.service] = (cnt[b.service] || 0) + 1; });
      const total = this.billing.length || 1;
      const palette = ["#425FAD", "#3B7CA8", "#8A6BB0", "#1F8A5B"];
      return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4)
        .map(([name, n], i) => ({ name, pct: Math.round((n / total) * 100) + "%", color: palette[i] }));
    },

    // ── modal Tambah ──
    get cfg() { return this.modal ? addConfigs[this.modal] : null; },
    openModal(id) {
      this.modal = id;
      this.modalError = ""; this.modalBusy = false;
      this.upload = { name: "", uploading: false, error: "", preview: "" };
      this.modalForm = Object.fromEntries(addConfigs[id].fields.map((f) => [
        f.key, f.default ?? (f.type === "select" ? f.options[0] : f.type === "days" ? dayLabels.map(() => false) : ""),
      ]));
    },
    get modalValid() {
      return !this.upload.uploading && !this.modalBusy
        && this.cfg.fields.every((f) => !f.required || String(this.modalForm[f.key] || "").trim());
    },

    // Panggilan tulis ke Laravel yang meneruskan ke backend /api/v1. 401 =
    // sesi berakhir → kembali ke login. Galat lain dikembalikan ke pemanggil.
    async apiWrite(method, url, body) {
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", "Accept": "application/json", "X-CSRF-TOKEN": csrf },
          body: body ? JSON.stringify(body) : null,
        });
        if (res.status === 401) { window.location.href = "/"; return { ok: false, message: "Sesi berakhir." }; }
        return await res.json();
      } catch {
        return { ok: false, message: "Tidak dapat menghubungi server." };
      }
    },

    async submitModal() {
      if (!this.modalValid) return;
      const cfg = this.cfg, key = cfg.list;
      const row = cfg.build(this.modalForm, this);
      // Entitas non-API: tetap lokal seperti FE lama.
      if (!API_RESOURCES.includes(key)) {
        this[key] = [row, ...this[key]];
        this.modal = null;
        this.showToast(cfg.title.replace("Tambah ", "") + " ditambahkan");
        return;
      }
      this.modalBusy = true; this.modalError = "";
      const res = await this.apiWrite("POST", `/dashboard/${key}/create`, this.modalForm);
      this.modalBusy = false;
      if (!res.ok) { this.modalError = res.message || "Gagal menyimpan ke server."; return; }
      if (res.id != null) row.id = res.id;   // pakai id backend agar hapus/status nanti nyambung
      this[key] = [row, ...this[key]];
      this.modal = null;
      this.showToast(cfg.title.replace("Tambah ", "") + " tersimpan");
    },

    // Hapus: kalau baris punya id backend → DELETE ke API; kalau belum (baris
    // lokal) → cukup buang dari daftar.
    async apiDelete(resource, r, msg) {
      if (r.id == null) { this.removeRow(resource, r, msg); return; }
      const res = await this.apiWrite("DELETE", `/dashboard/${resource}/${encodeURIComponent(r.id)}`);
      if (!res.ok) { this.showToast(res.message || "Gagal menghapus"); return; }
      this[resource] = this[resource].filter((x) => x !== r);
      this.showToast(msg);
    },

    // Toggle status aktif/nonaktif (patients & doctors punya endpoint /status).
    // Optimistik: ubah dulu, batalkan kalau backend menolak.
    async apiToggle(resource, r) {
      const next = !r.active;
      r.active = next;
      if (r.id == null) return;
      const res = await this.apiWrite("PATCH", `/dashboard/${resource}/${encodeURIComponent(r.id)}/status`, { active: next });
      if (!res.ok) { r.active = !next; this.showToast(res.message || "Gagal mengubah status"); }
    },
    async onFile(f, file) {
      if (!file) return;
      this.upload = { name: file.name, uploading: true, error: "", preview: URL.createObjectURL(file) };
      this.modalForm[f.key] = "";
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/dashboard/upload", { method: "POST", headers: { "X-CSRF-TOKEN": csrf }, body: fd });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.message) || "Upload gagal");
        this.modalForm[f.key] = json.url || file.name;
        this.upload.uploading = false;
      } catch (e) {
        this.upload.uploading = false;
        this.upload.error = e.message || "Upload gagal";
      }
    },

    removeRow(list, r, msg) { this[list] = this[list].filter((x) => x !== r); this.showToast(msg); },
    clinicLink(r) { return window.location.origin + "/" + r.slug; },
    copyClinicLink(r) { navigator.clipboard && navigator.clipboard.writeText(this.clinicLink(r)); this.showToast("Link publik disalin"); },
    submitFeature() {
      if (!this.featureForm.title.trim()) return;
      this.featureReqs = [{ title: this.featureForm.title.trim(), desc: this.featureForm.desc.trim(), date: todayStr(), status: "Terkirim" }, ...this.featureReqs];
      this.featureForm = { title: "", desc: "" };
      this.showToast("Permintaan fitur terkirim");
    },
  };
};
</script>
@endpush

@section('content')
<script type="application/json" id="dash-payload">@json($payload)</script>

<div class="dash" x-data="dashApp()" x-cloak>

  {{-- SIDEBAR --}}
  <div class="pq-sidebar">
    <div style="padding:22px 20px 14px;display:flex;align-items:center">
      <img src="/praktiqu-logo.png" alt="PraktiQu" style="height:30px;width:auto">
    </div>
    <div style="flex:1;overflow-y:auto;padding:6px 14px 14px">
      @php
        $NAV_META = [
          'dashboard' => ['Dashboard', 'grid'], 'appointments' => ['Appointments', 'calendar'], 'encounters' => ['Encounters', 'encounters'],
          'patients' => ['Patients', 'users'], 'doctors' => ['Doctors', 'stethoscope'], 'receptionists' => ['Receptionists', 'user-plus'],
          'clinics' => ['Clinics', 'building'], 'services' => ['Services', 'briefcase'], 'sessions' => ['Doctor Sessions', 'clock'],
          'billing' => ['Billing Records', 'receipt'], 'reports' => ['Reports', 'file-text'], 'settings' => ['Settings', 'gear'], 'features' => ['Request Features', 'features'],
        ];
        $SECTION_META = [
          ['Main', ['dashboard', 'appointments', 'encounters']], ['Users', ['patients', 'doctors', 'receptionists']],
          ['Clinic', ['clinics', 'services', 'sessions']], ['Financial', ['billing', 'reports']],
          ['Settings', ['settings']], ['Support', ['features']],
        ];
        $ALLOWED_NAV = [
          'super' => array_keys($NAV_META),
          'admin' => ['dashboard', 'appointments', 'encounters', 'patients', 'services', 'sessions', 'billing', 'settings'],
          'psikolog' => ['dashboard', 'appointments', 'encounters', 'patients', 'sessions', 'reports', 'settings'],
        ][$role] ?? [];
      @endphp
      @foreach ($SECTION_META as $sIdx => [$title, $items])
        @php $items = array_values(array_filter($items, fn ($id) => in_array($id, $ALLOWED_NAV, true))); @endphp
        @if ($items)
          <div>
            <div class="section-label" style="{{ $sIdx === 0 ? 'margin:10px 0 8px' : '' }}">{{ $title }}</div>
            @foreach ($items as $id)
              <a class="nav-item" :class="{ active: view === '{{ $id }}' }" @click="go('{{ $id }}')">
                <x-icon :name="$NAV_META[$id][1]" :size="19"/>
                <span style="flex:1">{{ $NAV_META[$id][0] }}</span>
                @if ($id === 'encounters')<x-icon name="chevron-right" :size="16" :sw="2" stroke="#C5C9D6"/>@endif
              </a>
            @endforeach
          </div>
        @endif
      @endforeach
    </div>
    <div style="border-top:1px solid #ECEEF3;padding:14px 16px;display:flex;align-items:center;gap:12px">
      <div class="avatar" style="width:42px;height:42px;font-size:14px;background:#425FAD" x-text="profile.initial"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:700;color:#1E2236;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" x-text="profile.name"></div>
        <div style="font-size:11.5px;color:#9499AE;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" x-text="profile.sub"></div>
      </div>
      <form method="POST" action="/logout" style="display:contents">@csrf
        <button type="submit" title="Keluar" style="color:#9499AE;cursor:pointer;flex:none;border:none;background:none;font-size:17px"><x-icon name="logout" :size="19"/></button>
      </form>
    </div>
  </div>

  {{-- MAIN --}}
  <div style="flex:1;min-width:0;display:flex;flex-direction:column">
    <div style="position:sticky;top:0;z-index:5;height:64px;background:#fff;border-bottom:1px solid #ECEEF3;display:flex;align-items:center;justify-content:flex-end;gap:16px;padding:0 32px">
      <div style="display:flex;align-items:center;gap:9px;border:1px solid #E4E6EF;border-radius:11px;padding:8px 13px;font-size:13.5px;font-weight:500;color:#3A3F5C;cursor:pointer">
        <span style="width:19px;height:13px;border-radius:2px;overflow:hidden;display:inline-flex;flex-direction:column;flex:none"><span style="flex:1;background:#D7232E"></span><span style="flex:1;background:#fff"></span></span>
        Bahasa Indonesia
      </div>
      <form method="POST" action="/logout">@csrf
        <button type="submit" style="border:none;background:none;color:#9499AE;cursor:pointer;font-size:13.5px;font-weight:600">Keluar</button>
      </form>
    </div>

    <div class="pq-content">
      {{-- error global --}}
      <template x-if="dataError">
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:16px;text-align:center">
          <div style="width:64px;height:64px;border-radius:16px;background:#FCE9E7;display:flex;align-items:center;justify-content:center;color:#E0594E;font-size:28px">!</div>
          <div style="font-size:15px;font-weight:700;color:#1E2236">Gagal memuat data</div>
          <div style="font-size:13px;color:#8A90A6;max-width:360px;line-height:1.5" x-text="dataError"></div>
          <button class="btn-primary" style="margin-top:8px" onclick="location.reload()">Coba Lagi</button>
        </div>
      </template>

      {{-- ═══ DASHBOARD ═══ --}}
      <div x-show="!dataError && view === 'dashboard'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> <b>Dashboard</b></div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div>
            <div style="font-size:27px;font-weight:800;color:#1E2236;letter-spacing:-.02em">Insights</div>
            <div style="font-size:13.5px;color:#8A90A6;margin-top:4px"><span x-text="OVERVIEW_SUB[role]"></span> · <span x-text="periodLabel"></span></div>
          </div>
          <div class="seg-wrap">
            <template x-for="p in periods" :key="p.id"><button class="seg" :class="{ active: p.id === period }" @click="period = p.id" x-text="p.label"></button></template>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(178px,1fr));gap:16px">
          @php
            $STAT_META = [
              'appointments' => ['Total Appointments', 'calendar', false], 'patients' => ['Total Patients', 'users-plus', false],
              'clinics' => ['Total Clinics', 'building', false], 'doctors' => ['Total Doctors', 'stethoscope', false],
              'services' => ['Active Services', 'badge-check', false], 'revenue' => ['Total Revenue', 'leaf', true],
            ];
            $STAT_KEYS = [
              'super' => ['appointments', 'patients', 'clinics', 'doctors', 'services', 'revenue'],
              'admin' => ['appointments', 'patients', 'services', 'revenue'],
              'psikolog' => ['appointments', 'patients', 'services', 'revenue'],
            ][$role] ?? ['appointments', 'patients', 'services', 'revenue'];
          @endphp
          @foreach ($STAT_KEYS as $key)
            @php [$label, $icon, $green] = $STAT_META[$key]; @endphp
            <div class="card-hover" style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:14px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:{{ $green ? '#E6F4EE' : '#ECEFFB' }};color:{{ $green ? '#1F8A5B' : '#425FAD' }}">
                <x-icon name="{{ $icon }}" :size="26" :sw="1.7"/>
              </div>
              <div style="font-size:30px;font-weight:800;color:#1E2236;letter-spacing:-.02em" x-text="stat['{{ $key }}'] || '—'"></div>
              <div style="font-size:13.5px;font-weight:600;color:#8A90A6">{{ $label }}</div>
            </div>
          @endforeach
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;margin-top:18px">
          <div class="card22">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
              <div style="font-size:17px;font-weight:700;color:#1E2236">Upcoming Appointments</div>
              <span @click="go('appointments')" style="font-size:13.5px;font-weight:600;color:#425FAD;cursor:pointer">View All</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div x-show="fAppts.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:20px">Belum ada appointment.</div>
              <template x-for="(r, i) in fAppts.slice(0, 2)" :key="i">
                <div style="background:#F7F8FB;border-radius:14px;padding:16px">
                  <div style="display:flex;align-items:center;gap:12px">
                    <div class="avatar" style="width:42px;height:42px;font-size:15px;background:#E0E5F6;color:#425FAD" x-text="r.initial"></div>
                    <div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#9499AE;margin-top:1px" x-text="r.clinic"></div></div>
                    <div style="text-align:right"><div style="font-size:12.5px;font-weight:700;color:#F2756A" x-text="r.date"></div><div style="font-size:12px;color:#9499AE;margin-top:1px" x-text="(r.time || '').split(' - ')[0]"></div></div>
                  </div>
                  <div style="font-size:13px;color:#5A6076;margin-top:12px;line-height:1.5"><span x-text="r.service"></span> · <span style="font-weight:600;color:#1E2236" x-text="r.doctor"></span></div>
                </div>
              </template>
            </div>
          </div>

          <div class="card22">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
              <div style="font-size:17px;font-weight:700;color:#1E2236" x-text="role === 'super' ? 'Top Doctors' : 'Jadwal Psikolog'"></div>
              <span @click="go('sessions')" style="font-size:13.5px;font-weight:600;color:#425FAD;cursor:pointer">View All</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:11px">
              <div x-show="sessions.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:20px">Belum ada data jadwal.</div>
              <template x-for="(d, i) in topSessions" :key="i">
                <div style="display:flex;align-items:center;gap:12px;background:#F7F8FB;border-radius:13px;padding:13px">
                  <div class="avatar" :style="`width:44px;height:44px;font-size:14px;background:${d.color}`" x-text="d.initial"></div>
                  <div style="flex:1;min-width:0"><div style="font-size:14.5px;font-weight:700;color:#1E2236" x-text="d.name"></div><div style="font-size:12px;color:#9499AE;margin-top:1px" x-text="d.clinic"></div></div>
                  <div style="font-size:13px;font-weight:700;color:#F2756A;flex:none;text-align:right"><span x-text="d.booked"></span><div style="font-size:11px;font-weight:500;color:#9499AE">sesi</div></div>
                </div>
              </template>
            </div>
          </div>

          <div class="card22" x-show="role === 'super'">
            <div style="font-size:17px;font-weight:700;color:#1E2236;margin-bottom:8px">Booking Status</div>
            <div style="font-size:13px;color:#9499AE;text-align:center;padding:30px">Data status booking akan ditampilkan dari API.</div>
          </div>
        </div>

        <div class="card22" style="margin-top:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div style="font-size:17px;font-weight:700;color:#1E2236">Payment History</div>
            <span x-show="allowed.includes('billing')" @click="go('billing')" style="font-size:13.5px;font-weight:600;color:#425FAD;cursor:pointer">View All</span>
          </div>
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:760px">
              <thead><tr><th>Patient</th><th>Date</th><th>Doctor</th><th>Service</th><th style="text-align:right">Charges</th></tr></thead>
              <tbody>
                <tr x-show="fBilling.length === 0"><td colspan="5" class="empty">Belum ada data tagihan.</td></tr>
                <template x-for="(r, i) in fBilling.slice(0, 3)" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:11px"><div class="avatar" style="width:36px;height:36px;font-size:12.5px;background:#E0E5F6;color:#425FAD" x-text="r.initial"></div><div style="font-size:13.5px;font-weight:700;color:#1E2236" x-text="r.name"></div></div></td>
                    <td x-text="r.date"></td><td x-text="r.doctor"></td><td x-text="r.service"></td>
                    <td style="font-size:13.5px;font-weight:700;color:#1E2236;text-align:right" x-text="r.total"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ APPOINTMENTS ═══ --}}
      <div x-show="!dataError && view === 'appointments'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Appointments <span>›</span> <b>All Appointments</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div>
            <div class="page-title">All Appointments</div>
            <div style="font-size:13px;color:#8A90A6;margin-top:4px">Zona waktu: <span style="font-weight:600;color:#5A6076">Asia/Jakarta</span></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red"><x-icon name="plus" :size="16" :sw="2.2"/>Add Appointment</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
            <button class="btn-white"><x-icon name="import" :size="16" :sw="2"/>Import Data</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:170px">Upcoming <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div class="filter-pill" style="min-width:190px">Pilih rentang tanggal</div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari apa saja"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:920px">
              <thead><tr><th>Appointment Details</th><th>Date &amp; Time</th><th>Service</th><th>Charges</th><th>Payment</th><th>Status</th></tr></thead>
              <tbody>
                <tr x-show="fAppts.length === 0"><td colspan="6" class="empty">Belum ada appointment.</td></tr>
                <template x-for="(r, i) in fAppts" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:40px;height:40px;font-size:13px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#8A90A6;margin-top:1px">Dokter: <span x-text="r.doctor"></span></div><div style="font-size:12px;color:#8A90A6">Klinik: <span x-text="r.clinic"></span></div></div>
                    </div></td>
                    <td><div style="font-size:13px;font-weight:600;color:#1E2236" x-text="r.date"></div><div style="font-size:12px;color:#8A90A6;margin-top:2px" x-text="r.time"></div></td>
                    <td x-text="r.service"></td>
                    <td style="font-size:13.5px;font-weight:700;color:#1E2236" x-text="r.charges"></td>
                    <td x-text="r.payment"></td>
                    <td><span class="badge" :class="r.badge" x-text="r.status"></span></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:16px 6px 4px">
            <div style="font-size:13px;color:#8A90A6">Menampilkan <span x-text="fAppts.length"></span> entri</div>
          </div>
        </div>
      </div>

      {{-- ═══ PATIENTS ═══ --}}
      <div x-show="!dataError && view === 'patients'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Patients <span>›</span> <b>All Patients</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">All Patients</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" @click="openModal('patient')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Patient</button>
            <button class="btn-white"><x-icon name="import" :size="16" :sw="2"/>Import Data</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:160px">Pilih Klinik <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div class="filter-pill" style="min-width:140px">Status <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari apa saja"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:900px">
              <thead><tr><th>Patient</th><th>Clinic</th><th>Mobile</th><th>Registered</th><th style="text-align:center">Status</th><th style="text-align:center">Action</th></tr></thead>
              <tbody>
                <tr x-show="fPatients.length === 0"><td colspan="6" class="empty">Belum ada pasien.</td></tr>
                <template x-for="(r, i) in fPatients" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:38px;height:38px;font-size:12.5px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#8A90A6;margin-top:1px" x-text="r.email"></div></div>
                    </div></td>
                    <td><span :style="r.clinicTag ? 'background:#DFF1F6;color:#2C7A99;font-size:12px;font-weight:600;padding:5px 11px;border-radius:8px;display:inline-block' : 'color:#9499AE;font-size:13px'" x-text="r.clinic"></span></td>
                    <td x-text="r.mobile"></td>
                    <td x-text="r.reg"></td>
                    <td><div style="display:flex;justify-content:center"><div class="toggle" :class="{ on: r.active }" @click="apiToggle('patients', r)"><div class="knob"></div></div></div></td>
                    <td><div style="display:flex;justify-content:center;gap:10px">
                      <span @click="openModal('patient')" title="Edit" style="color:#1F8A5B;cursor:pointer;display:inline-flex"><x-icon name="edit" :size="17" stroke="#1F8A5B"/></span>
                      <span @click="apiDelete('patients', r, 'Pasien dihapus')" title="Hapus" style="color:#E0594E;cursor:pointer;display:inline-flex"><x-icon name="trash" :size="17" stroke="#E0594E"/></span>
                    </div></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ DOCTORS ═══ --}}
      <div x-show="!dataError && view === 'doctors'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Doctors <span>›</span> <b>All Doctors</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">All Doctors</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" @click="openModal('doctor')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Doctor</button>
            <button class="btn-white"><x-icon name="import" :size="16" :sw="2"/>Import Data</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:150px">Clinic <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div class="filter-pill" style="min-width:170px">Specializations <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari apa saja"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:900px">
              <thead><tr><th>Doctor</th><th>Clinic</th><th>Mobile</th><th>Specialization</th><th style="text-align:center">Status</th></tr></thead>
              <tbody>
                <tr x-show="fDoctors.length === 0"><td colspan="5" class="empty">Belum ada dokter.</td></tr>
                <template x-for="(r, i) in fDoctors" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:38px;height:38px;font-size:12.5px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#8A90A6;margin-top:1px" x-text="r.email"></div></div>
                    </div></td>
                    <td><span style="background:#EAF0FB;color:#425FAD;font-size:12px;font-weight:600;padding:5px 11px;border-radius:8px;display:inline-block" x-text="r.clinic"></span></td>
                    <td x-text="r.mobile"></td>
                    <td><span style="background:#E6F4EE;color:#1F8A5B;font-size:12px;font-weight:600;padding:5px 11px;border-radius:8px;display:inline-block" x-text="r.spec"></span></td>
                    <td><div style="display:flex;justify-content:center"><div class="toggle" :class="{ on: r.active }" @click="apiToggle('doctors', r)"><div class="knob"></div></div></div></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ BILLING ═══ --}}
      <div x-show="!dataError && view === 'billing'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Billing Records <span>›</span> <b>All Billings</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">Billing Records</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" @click="openModal('bill')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Bill</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filter</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:190px">Pilih rentang tanggal</div>
          <div class="filter-pill" style="min-width:140px">Status <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari apa saja"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:960px">
              <thead><tr><th>Bill</th><th>Date</th><th>Service</th><th style="text-align:right">Amount</th><th style="text-align:center">Status</th></tr></thead>
              <tbody>
                <tr x-show="fBilling.length === 0"><td colspan="5" class="empty">Belum ada tagihan.</td></tr>
                <template x-for="(r, i) in fBilling" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:38px;height:38px;font-size:12.5px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236"><span x-text="r.name"></span> <span style="font-size:11.5px;font-weight:500;color:#9499AE" x-text="'#' + r.id"></span></div><div style="font-size:12px;color:#8A90A6;margin-top:1px" x-text="r.doctor"></div><div style="font-size:12px;color:#8A90A6" x-text="r.clinic"></div></div>
                    </div></td>
                    <td x-text="r.date"></td>
                    <td x-text="r.service"></td>
                    <td style="text-align:right"><div style="font-size:13.5px;font-weight:700;color:#1E2236" x-text="r.total"></div><div style="font-size:11.5px;color:#9499AE;margin-top:1px">Diskon <span x-text="r.discount"></span></div></td>
                    <td style="text-align:center"><span class="badge" :class="r.badge" x-text="r.status"></span></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ SERVICES ═══ --}}
      <div x-show="!dataError && view === 'services'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Services <span>›</span> <b>All Services</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">Services</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" @click="openModal('service')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Service</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:150px">Clinic <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div class="filter-pill" style="min-width:140px">Mode <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari layanan"></div>
        </div>
        <div x-show="fServices.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:40px">Belum ada layanan.</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
          <template x-for="(r, i) in fServices" :key="i">
            <div class="card-hover" style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(30,40,80,.04);display:flex;flex-direction:column;gap:14px">
              <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                <div :style="`width:48px;height:48px;border-radius:13px;display:flex;align-items:center;justify-content:center;color:#fff;flex:none;background:${r.color};font-size:20px`"><x-icon name="heart" :size="24" stroke="#fff"/></div>
                <span :style="`background:${r.mode === 'Online' ? '#E6F4EE' : '#FDEDE6'};color:${r.mode === 'Online' ? '#1F8A5B' : '#DC7A4E'};font-size:11.5px;font-weight:700;padding:4px 11px;border-radius:99px`" x-text="r.mode"></span>
              </div>
              <div>
                <div style="font-size:15.5px;font-weight:700;color:#1E2236;line-height:1.35" x-text="r.name"></div>
                <div style="font-size:12.5px;color:#8A90A6;margin-top:5px" x-text="r.clinic"></div>
              </div>
              <div style="height:1px;background:#F0F1F6"></div>
              <div style="display:flex;align-items:center;justify-content:space-between">
                <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#8A90A6"><x-icon name="clock" :size="16"/> <span x-text="r.duration"></span></div>
                <div style="font-size:16px;font-weight:800;color:#425FAD" x-text="r.price"></div>
              </div>
            </div>
          </template>
        </div>
      </div>

      {{-- ═══ DOCTOR SESSIONS ═══ --}}
      <div x-show="!dataError && view === 'sessions'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Doctor Sessions <span>›</span> <b>Schedules</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div>
            <div class="page-title">Doctor Sessions</div>
            <div style="font-size:13px;color:#8A90A6;margin-top:4px">Jadwal praktik &amp; ketersediaan slot per psikolog</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" x-show="sessionTab === 'reguler'" @click="openModal('session')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Session</button>
            <button class="btn-red" x-show="sessionTab === 'nonreguler'" @click="openModal('sessionCustom')"><x-icon name="plus" :size="16" :sw="2.2"/>Jadwal Custom</button>
            <button class="btn-blue" x-show="sessionTab === 'nonreguler'" @click="openModal('sessionDadakan')"><x-icon name="plus" :size="16" :sw="2.2"/>Jadwal Dadakan</button>
            <button class="btn-red" x-show="sessionTab === 'libur'" @click="openModal('holiday')"><x-icon name="plus" :size="16" :sw="2.2"/>Tambah Libur</button>
            <button class="btn-white"><x-icon name="calendar" :size="16" :sw="1.8"/>Kalender</button>
          </div>
        </div>
        <div class="seg-wrap" style="margin-bottom:18px;width:fit-content">
          <button class="seg" :class="{ active: sessionTab === 'reguler' }" @click="sessionTab = 'reguler'">Reguler</button>
          <button class="seg" :class="{ active: sessionTab === 'nonreguler' }" @click="sessionTab = 'nonreguler'">Non-Reguler</button>
          <button class="seg" :class="{ active: sessionTab === 'libur' }" @click="sessionTab = 'libur'">Jadwal Libur</button>
        </div>

        <div x-show="sessionTab === 'reguler'" style="display:flex;flex-direction:column;gap:14px">
          <div x-show="sessions.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:40px">Belum ada jadwal reguler.</div>
          <template x-for="(r, i) in sessions" :key="i">
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div class="avatar" :style="`width:46px;height:46px;font-size:14px;background:${r.color}`" x-text="r.initial"></div>
                <div style="flex:1;min-width:180px"><div style="font-size:15px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12.5px;color:#8A90A6;margin-top:1px"><span x-text="r.clinic"></span> · <span x-text="r.mode"></span></div></div>
                <div style="text-align:right"><div style="font-size:12px;color:#8A90A6">Slot terisi</div><div style="font-size:15px;font-weight:700;color:#1E2236;margin-top:1px"><span x-text="r.booked"></span>/<span x-text="r.capacity"></span></div></div>
                <span class="badge" :class="r.status === 'full' ? 'salmon' : 'green'" x-text="r.status === 'full' ? 'Penuh' : 'Tersedia'"></span>
                <span @click="apiDelete('sessions', r, 'Sesi dihapus')" title="Hapus" style="color:#E0594E;cursor:pointer;display:inline-flex"><x-icon name="trash" :size="17" stroke="#E0594E"/></span>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
                <template x-for="(lbl, di) in dayLabels" :key="di"><div class="day-chip" :class="{ on: r.active[di] }" x-text="lbl"></div></template>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#5A6076"><x-icon name="clock" :size="16"/> Jam praktik: <span style="font-weight:600;color:#1E2236" x-text="r.hours"></span></div>
            </div>
          </template>
        </div>

        <div x-show="sessionTab === 'nonreguler'" style="display:flex;flex-direction:column;gap:14px">
          <div x-show="nonRegular.length === 0" style="font-size:13px;color:#9499AE">Belum ada jadwal custom atau dadakan.</div>
          <template x-for="r in nonRegular" :key="r.id">
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div class="avatar" :style="`width:46px;height:46px;font-size:14px;background:${r.color}`" x-text="r.initial"></div>
                <div style="flex:1;min-width:180px"><div style="font-size:15px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12.5px;color:#8A90A6;margin-top:1px"><span x-text="r.clinic"></span> · <span x-text="r.mode"></span></div></div>
                <span :style="`background:${r.kind === 'custom' ? '#E8EFFB' : '#FDEDE6'};color:${r.kind === 'custom' ? '#3B6FD0' : '#DC7A4E'};font-size:11.5px;font-weight:700;padding:4px 11px;border-radius:99px`" x-text="r.kind === 'custom' ? 'Custom' : 'Dadakan'"></span>
                <span @click="removeRow('nonRegular', r, 'Jadwal dihapus')" title="Hapus" style="color:#E0594E;cursor:pointer"><x-icon name="trash" :size="17" stroke="#E0594E"/></span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#5A6076;flex-wrap:wrap">
                <x-icon name="calendar" :size="16"/> <span style="font-weight:600;color:#1E2236" x-text="r.date"></span>
                <x-icon name="clock" :size="16"/> <span style="font-weight:600;color:#1E2236" x-text="r.time"></span>
                <span x-show="r.note" style="color:#8A90A6" x-text="'· ' + r.note"></span>
              </div>
            </div>
          </template>
        </div>

        <div x-show="sessionTab === 'libur'" style="display:flex;flex-direction:column;gap:14px">
          <div x-show="holidays.length === 0" style="font-size:13px;color:#9499AE">Belum ada jadwal libur.</div>
          <template x-for="r in holidays" :key="r.id">
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                <div class="avatar" :style="`width:46px;height:46px;font-size:14px;background:${r.color}`" x-text="r.initial"></div>
                <div style="flex:1;min-width:180px"><div style="font-size:15px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12.5px;color:#8A90A6;margin-top:1px" x-text="r.clinic"></div></div>
                <span class="badge salmon" x-text="r.timeLabel"></span>
                <span @click="removeRow('holidays', r, 'Jadwal libur dihapus')" title="Hapus" style="color:#E0594E;cursor:pointer"><x-icon name="trash" :size="17" stroke="#E0594E"/></span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:13px;color:#5A6076;flex-wrap:wrap">
                <x-icon name="calendar" :size="16"/> <span style="font-weight:600;color:#1E2236" x-text="r.date"></span>
                <span x-show="r.note" style="color:#8A90A6" x-text="'· ' + r.note"></span>
              </div>
            </div>
          </template>
        </div>
      </div>

      {{-- ═══ REPORTS ═══ --}}
      <div x-show="!dataError && view === 'reports'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> <b>Reports</b></div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div>
            <div class="page-title">Reports</div>
            <div style="font-size:13px;color:#8A90A6;margin-top:4px">Performa klinik · <span x-text="periodLabel"></span></div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <div class="seg-wrap">
              <template x-for="p in periods" :key="p.id"><button class="seg" :class="{ active: p.id === period }" @click="period = p.id" x-text="p.label"></button></template>
            </div>
            <button style="background:#1F8A5B;color:#fff;border:none;border-radius:11px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer"><x-icon name="download" :size="16" :sw="2"/>Export</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:18px">
          <template x-for="c in [{ l: 'Total Pendapatan', v: stat.revenue }, { l: 'Sesi Selesai', v: stat.appointments }, { l: 'Pasien', v: stat.patients }]" :key="c.l">
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="font-size:13px;color:#8A90A6;font-weight:600" x-text="c.l"></div>
              <div style="font-size:27px;font-weight:800;color:#1E2236;margin-top:8px;letter-spacing:-.02em" x-text="c.v || '—'"></div>
              <div style="font-size:12.5px;color:#8A90A6;font-weight:500;margin-top:6px">Data dari API</div>
            </div>
          </template>
        </div>
        <div class="grid-2col" style="display:grid;grid-template-columns:1.6fr 1fr;gap:18px;align-items:start">
          <div class="card22">
            <div style="font-size:16px;font-weight:700;color:#1E2236;margin-bottom:4px">Tren Pendapatan</div>
            <div style="font-size:12.5px;color:#8A90A6;margin-bottom:20px">Pendapatan per bulan</div>
            <div style="display:flex;align-items:flex-end;gap:14px;height:200px;padding-top:10px">
              <div x-show="revenue.length === 0" style="font-size:13px;color:#9499AE;margin:auto">Belum ada data pendapatan.</div>
              <template x-for="(b, i) in revenue" :key="i">
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:9px;height:100%;justify-content:flex-end">
                  <div style="font-size:11.5px;font-weight:700;color:#425FAD" x-text="b.val"></div>
                  <div :style="`width:100%;max-width:40px;border-radius:8px 8px 0 0;background:linear-gradient(180deg,#5E78C8,#425FAD);height:${b.h}%`"></div>
                  <div style="font-size:11.5px;color:#8A90A6" x-text="b.label"></div>
                </div>
              </template>
            </div>
          </div>
          <div class="card22">
            <div style="font-size:16px;font-weight:700;color:#1E2236;margin-bottom:18px">Layanan Terpopuler</div>
            <div style="display:flex;flex-direction:column;gap:16px">
              <div x-show="topServices.length === 0" style="font-size:13px;color:#9499AE">Belum ada data.</div>
              <template x-for="(t, i) in topServices" :key="i">
                <div>
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px"><span style="font-size:13px;color:#5A6076" x-text="t.name"></span><span style="font-size:13px;font-weight:700;color:#1E2236" x-text="t.pct"></span></div>
                  <div style="height:8px;border-radius:99px;background:#EEF0F6;overflow:hidden"><div :style="`height:100%;border-radius:99px;background:${t.color};width:${t.pct}`"></div></div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      {{-- ═══ SETTINGS ═══ --}}
      <div x-show="!dataError && view === 'settings'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> <b>Settings</b></div>
        <div class="page-title" style="margin-bottom:20px">Settings</div>
        <div class="grid-2col" style="display:grid;grid-template-columns:240px 1fr;gap:18px;align-items:start">
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:16px;padding:10px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <template x-for="t in settingsTabList" :key="t.id">
              <div @click="settingsTab = t.id" :style="`display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:11px;font-size:14px;font-weight:${settingsTab === t.id ? 600 : 500};color:${settingsTab === t.id ? '#425FAD' : '#6B7186'};background:${settingsTab === t.id ? '#ECEFFB' : 'transparent'};cursor:pointer`">
                <span :style="`width:7px;height:7px;border-radius:99px;flex:none;background:${settingsTab === t.id ? '#425FAD' : '#C8CDDE'}`"></span><span x-text="t.label"></span>
              </div>
            </template>
          </div>
          <div style="display:flex;flex-direction:column;gap:18px">
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="font-size:17px;font-weight:700;color:#1E2236;margin-bottom:4px" x-text="(settingsTabList.find((t) => t.id === settingsTab) || {}).label || ''"></div>
              <div style="font-size:13px;color:#8A90A6;margin-bottom:20px">Kelola informasi yang tampil di profil dan dokumen klinik Anda.</div>
              <div class="grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:18px">
                <div><label class="lbl">Nama Klinik</label><input class="inp-sm inp-blue"></div>
                <div><label class="lbl">Email Klinik</label><input class="inp-sm inp-blue"></div>
                <div><label class="lbl">Nomor Telepon</label><input class="inp-sm inp-blue"></div>
                <div><label class="lbl">Zona Waktu</label><div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1.5px solid #DDE1EC;border-radius:11px;font-size:14px;color:#1E2236;cursor:pointer">Asia/Jakarta (WIB) <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div></div>
              </div>
            </div>
            <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
              <div style="font-size:15px;font-weight:700;color:#1E2236;margin-bottom:16px">Preferensi</div>
              <div style="display:flex;flex-direction:column;gap:4px">
                <template x-for="p in [{ key: 'emailNotif', title: 'Notifikasi Email', desc: 'Kirim ringkasan booking ke email admin' }, { key: 'waReminder', title: 'Pengingat WhatsApp', desc: 'Kirim pengingat sesi H-1 ke pasien' }, { key: 'autoConfirm', title: 'Konfirmasi Otomatis', desc: 'Booking langsung dikonfirmasi tanpa review' }]" :key="p.key">
                  <div style="display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-bottom:1px solid #F0F1F6">
                    <div><div style="font-size:14px;font-weight:600;color:#1E2236" x-text="p.title"></div><div style="font-size:12.5px;color:#8A90A6;margin-top:2px" x-text="p.desc"></div></div>
                    <div class="toggle" :class="{ on: prefs[p.key] }" @click="prefs[p.key] = !prefs[p.key]"><div class="knob"></div></div>
                  </div>
                </template>
              </div>
              <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px">
                <button class="btn-white" @click="prefs = { emailNotif: true, waReminder: true, autoConfirm: false }">Batal</button>
                <button class="btn-primary" style="box-shadow:0 8px 20px -8px rgba(66,95,173,.6)" @click="showToast('Perubahan disimpan')">Simpan Perubahan</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {{-- ═══ ENCOUNTERS ═══ --}}
      <div x-show="!dataError && view === 'encounters'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Encounters <span>›</span> <b>All Encounters</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div>
            <div class="page-title">Encounters</div>
            <div style="font-size:13px;color:#8A90A6;margin-top:4px">Riwayat sesi &amp; catatan kunjungan pasien</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red"><x-icon name="plus" :size="16" :sw="2.2"/>New Encounter</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:150px">Status <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari encounter"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:880px">
              <thead><tr><th>Patient</th><th>Doctor</th><th>Date &amp; Time</th><th>Type</th><th style="text-align:center">Status</th></tr></thead>
              <tbody>
                <tr x-show="fEncounters.length === 0"><td colspan="5" class="empty">Belum ada encounter.</td></tr>
                <template x-for="(r, i) in fEncounters" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:38px;height:38px;font-size:12.5px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#8A90A6;margin-top:1px" x-text="r.note"></div></div>
                    </div></td>
                    <td x-text="r.doctor"></td>
                    <td><div style="font-size:13px;font-weight:600;color:#1E2236" x-text="r.date"></div><div style="font-size:12px;color:#8A90A6;margin-top:2px" x-text="r.time"></div></td>
                    <td x-text="r.type"></td>
                    <td style="text-align:center"><span class="badge" :class="r.badge" x-text="r.status"></span></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ RECEPTIONISTS ═══ --}}
      <div x-show="!dataError && view === 'receptionists'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Receptionists <span>›</span> <b>All Receptionists</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">Receptionists</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn-red" @click="openModal('receptionist')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Receptionist</button>
            <button class="btn-blue"><x-icon name="filter" :size="16" :sw="2"/>Filters</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div class="filter-pill" style="min-width:150px">Clinic <x-icon name="chevron-down" :size="15" :sw="2" stroke="#9499AE"/></div>
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari resepsionis"></div>
        </div>
        <div class="card">
          <div class="tbl-wrap">
            <table class="tbl" style="min-width:820px">
              <thead><tr><th>Receptionist</th><th>Clinic</th><th>Mobile</th><th style="text-align:center">Status</th><th style="text-align:center">Action</th></tr></thead>
              <tbody>
                <tr x-show="fReceptionists.length === 0"><td colspan="5" class="empty">Belum ada resepsionis.</td></tr>
                <template x-for="(r, i) in fReceptionists" :key="i">
                  <tr>
                    <td><div style="display:flex;align-items:center;gap:12px">
                      <div class="avatar" :style="`width:38px;height:38px;font-size:12.5px;background:${r.color}`" x-text="r.initial"></div>
                      <div><div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.name"></div><div style="font-size:12px;color:#8A90A6;margin-top:1px" x-text="r.email"></div></div>
                    </div></td>
                    <td><span style="background:#EAF0FB;color:#425FAD;font-size:12px;font-weight:600;padding:5px 11px;border-radius:8px;display:inline-block" x-text="r.clinic"></span></td>
                    <td x-text="r.mobile"></td>
                    <td><div style="display:flex;justify-content:center"><div class="toggle" :class="{ on: r.active }" @click="r.active = !r.active"><div class="knob"></div></div></div></td>
                    <td><div style="display:flex;justify-content:center;gap:10px"><span @click="apiDelete('receptionists', r, 'Resepsionis dihapus')" title="Hapus" style="color:#E0594E;cursor:pointer;display:inline-flex"><x-icon name="trash" :size="17" stroke="#E0594E"/></span></div></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {{-- ═══ CLINICS ═══ --}}
      <div x-show="!dataError && view === 'clinics'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> Clinics <span>›</span> <b>All Clinics</b></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px">
          <div class="page-title">Clinics</div>
          <button class="btn-red" @click="openModal('clinic')"><x-icon name="plus" :size="16" :sw="2.2"/>Add Clinic</button>
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px">
          <div style="flex:1"></div>
          <div class="search-box"><x-icon name="search" :size="16" :sw="2" stroke="#9499AE"/><input x-model="search" placeholder="Cari klinik"></div>
        </div>
        <div x-show="fClinics.length === 0" style="font-size:13px;color:#9499AE;text-align:center;padding:40px">Belum ada klinik.</div>
        <div class="clinic-grid">
          <template x-for="(r, i) in fClinics" :key="i">
            <div class="clinic-card card-hover">
              <div class="clinic-head">
                <template x-if="r.ownerPhoto"><img class="clinic-avatar" :src="r.ownerPhoto" :alt="r.name" title="Foto pemilik klinik"></template>
                <template x-if="!r.ownerPhoto"><div class="avatar clinic-avatar" :style="`background:${r.color}`" x-text="r.initial"></div></template>
                <div class="clinic-id">
                  <div class="clinic-name" :title="r.name" x-text="r.name"></div>
                  <span class="badge" :class="r.active ? 'green' : 'red'" style="margin-top:7px" x-text="r.active ? 'Aktif' : 'Nonaktif'"></span>
                </div>
              </div>
              <div class="clinic-addr" :class="!r.address && 'kosong'" :title="r.address" x-text="r.address || 'Alamat belum diisi'"></div>
              <div class="clinic-foot">
                <div class="clinic-meta">
                  <div class="clinic-phone" :title="r.phone" x-text="r.phone || '—'"></div>
                  <div class="clinic-dokter" :class="!r.doctors && 'nol'" x-text="r.doctors + ' dokter'"></div>
                </div>
                <div x-show="r.id != null || r.slug" class="clinic-link">
                  <span class="clinic-url" :title="'Link booking publik klinik ini: ' + clinicLink(r)">
                    <span class="garis">/</span>
                    <span class="slug" x-text="r.slug"></span>
                  </span>
                  <button class="clinic-act" @click="copyClinicLink(r)" title="Salin link booking" aria-label="Salin link booking"><x-icon name="clipboard" :size="15" :sw="1.9"/></button>
                  <a class="clinic-act" :href="'/' + r.slug" target="_blank" rel="noreferrer" title="Buka halaman booking di tab baru" aria-label="Buka halaman booking di tab baru"><x-icon name="external" :size="15" :sw="1.9"/></a>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      {{-- ═══ REQUEST FEATURES ═══ --}}
      <div x-show="!dataError && view === 'features'" class="anim-up">
        <div class="breadcrumb">Home <span>›</span> <b>Request Features</b></div>
        <div class="page-title" style="margin-bottom:4px">Request Features</div>
        <div style="font-size:13.5px;color:#8A90A6;margin-bottom:20px">Punya ide untuk meningkatkan PraktiQu? Kirimkan permintaan Anda di sini.</div>
        <div class="grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:18px;align-items:start">
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:16px;font-weight:700;color:#1E2236;margin-bottom:18px">Permintaan Baru</div>
            <label class="lbl">Judul Fitur</label>
            <input class="inp-sm inp-blue" x-model="featureForm.title" placeholder="mis. Integrasi kalender Google" style="margin-bottom:16px">
            <label class="lbl">Deskripsi</label>
            <textarea class="inp-sm inp-blue" x-model="featureForm.desc" placeholder="Jelaskan fitur yang Anda inginkan…" rows="4" style="resize:vertical"></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:18px">
              <button :disabled="!featureForm.title.trim()" @click="submitFeature()"
                :style="`background:${featureForm.title.trim() ? '#425FAD' : '#C3C9DD'};color:#fff;border:none;border-radius:11px;padding:11px 22px;font-size:14px;font-weight:600;cursor:${featureForm.title.trim() ? 'pointer' : 'not-allowed'}`"><x-icon name="plus" :size="16" :sw="2.2"/>Kirim Permintaan</button>
            </div>
          </div>
          <div style="background:#fff;border:1px solid #ECEEF3;border-radius:18px;padding:24px;box-shadow:0 1px 2px rgba(30,40,80,.04)">
            <div style="font-size:16px;font-weight:700;color:#1E2236;margin-bottom:18px">Permintaan Anda <span style="font-size:13px;font-weight:500;color:#9499AE" x-text="'(' + featureReqs.length + ')'"></span></div>
            <div x-show="featureReqs.length === 0" style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:34px 16px;color:#9499AE">
              <div style="width:60px;height:60px;border-radius:16px;background:#ECEFFB;display:flex;align-items:center;justify-content:center;color:#425FAD;margin-bottom:14px;font-size:24px"><x-icon name="features" :size="24"/></div>
              <div style="font-size:13.5px;line-height:1.55;max-width:240px">Belum ada permintaan. Kirim ide pertama Anda lewat form di samping.</div>
            </div>
            <div x-show="featureReqs.length > 0" style="display:flex;flex-direction:column;gap:12px">
              <template x-for="(r, i) in featureReqs" :key="i">
                <div style="background:#F7F8FB;border-radius:13px;padding:15px">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
                    <div style="font-size:14px;font-weight:700;color:#1E2236" x-text="r.title"></div>
                    <span class="badge blue" x-text="r.status"></span>
                  </div>
                  <div x-show="r.desc" style="font-size:12.5px;color:#5A6076;margin-top:6px;line-height:1.5" x-text="r.desc"></div>
                  <div style="font-size:11.5px;color:#9499AE;margin-top:8px" x-text="r.date"></div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>

  {{-- ═══ MODAL TAMBAH ═══ --}}
  <template x-if="cfg">
    <div class="modal-overlay" @click="modal = null">
      <div class="modal-card" @click.stop>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:22px 24px;border-bottom:1px solid #ECEEF3">
          <div style="font-size:18px;font-weight:800;color:#1E2236;letter-spacing:-.01em" x-text="cfg.title"></div>
          <div @click="modal = null" style="width:32px;height:32px;border-radius:9px;background:#F4F5F9;color:#6B7186;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px">×</div>
        </div>
        <div style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
          <template x-for="f in cfg.fields" :key="f.key">
            <div>
              <label class="lbl"><span x-text="f.label"></span><span x-show="f.required" style="color:#E0594E"> *</span></label>
              <template x-if="f.type === 'select'">
                <select class="inp-sm inp-blue" x-model="modalForm[f.key]" style="cursor:pointer">
                  <template x-for="o in f.options" :key="o"><option :value="o" x-text="o"></option></template>
                </select>
              </template>
              <template x-if="f.type === 'date'">
                <input class="inp-sm inp-blue" type="date" x-model="modalForm[f.key]">
              </template>
              <template x-if="f.type === 'days'">
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <template x-for="(lbl, i) in dayLabels" :key="i">
                    <div class="day-chip" :class="{ on: modalForm[f.key][i] }" style="cursor:pointer" @click="modalForm[f.key][i] = !modalForm[f.key][i]" x-text="lbl"></div>
                  </template>
                </div>
              </template>
              <template x-if="f.type === 'file'">
                <label :style="`display:flex;align-items:center;gap:13px;padding:12px 14px;border-radius:11px;cursor:pointer;border:1.5px dashed ${modalForm[f.key] ? '#425FAD' : upload.error ? '#E0594E' : '#C8CDDE'};background:${modalForm[f.key] ? '#ECEFFB' : '#fff'}`">
                  <input type="file" accept="image/*" @change="onFile(f, $event.target.files && $event.target.files[0])" style="display:none">
                  <template x-if="upload.preview"><img :src="upload.preview" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;flex:none"></template>
                  <template x-if="!upload.preview"><div style="width:44px;height:44px;border-radius:10px;background:#F4F5F9;color:#9499AE;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none">+</div></template>
                  <div style="min-width:0">
                    <div style="font-size:13.5px;font-weight:600;color:#1E2236;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" x-text="upload.name || f.placeholder || 'Pilih foto…'"></div>
                    <div :style="`font-size:12px;margin-top:2px;color:${upload.error ? '#E0594E' : upload.uploading ? '#C58A2E' : modalForm[f.key] ? '#3E9B6B' : '#9499AE'}`"
                      x-text="upload.error ? upload.error + ' — klik untuk coba lagi' : upload.uploading ? 'Mengunggah…' : modalForm[f.key] ? '✓ Terupload ke server' : 'JPG/PNG, langsung diunggah'"></div>
                  </div>
                </label>
              </template>
              <template x-if="!f.type || f.type === 'text'">
                <input class="inp-sm inp-blue" x-model="modalForm[f.key]" :placeholder="f.placeholder || ''">
              </template>
            </div>
          </template>
        </div>
        <div x-show="modalError" style="margin:0 24px;background:#FCE9E7;color:#D7453B;font-size:12.5px;font-weight:600;padding:10px 14px;border-radius:11px" x-text="modalError"></div>
        <div style="display:flex;justify-content:flex-end;gap:10px;padding:16px 24px 24px">
          <button class="btn-white" @click="modal = null">Batal</button>
          <button :disabled="!modalValid" @click="submitModal()"
            :style="`background:${modalValid ? '#425FAD' : '#C3C9DD'};color:#fff;border:none;border-radius:11px;padding:11px 22px;font-size:14px;font-weight:600;cursor:${modalValid ? 'pointer' : 'not-allowed'}`"
            x-text="modalBusy ? 'Menyimpan…' : 'Simpan'">Simpan</button>
        </div>
      </div>
    </div>
  </template>

  {{-- TOAST --}}
  <div class="toast" x-show="toast" x-text="toast"></div>
</div>
@endsection
