@extends('layouts.base')
@section('title', 'Masuk — PraktiQu')

@section('content')
<div class="auth-wrap">
  <div class="auth-card">

    {{-- BRAND PANEL --}}
    <div class="auth-brand">
      <div style="position:absolute;top:-90px;right:-70px;width:280px;height:280px;border-radius:99px;background:radial-gradient(circle at 30% 30%,#425FAD,rgba(66,95,173,0));opacity:.55"></div>
      <div style="position:absolute;bottom:-110px;left:-60px;width:260px;height:260px;border-radius:99px;background:radial-gradient(circle at 50% 50%,#5BC4BC,rgba(91,196,188,0));opacity:.28"></div>

      <div style="position:relative;z-index:1">
        <div style="background:#fff;border-radius:13px;padding:12px 18px;display:inline-flex;align-items:center">
          <img src="/praktiqu-logo.png" alt="PraktiQu" style="height:34px;width:auto">
        </div>
      </div>

      <div class="auth-brand-detail" style="position:relative;z-index:1;margin-top:auto">
        <div style="font-family:'Newsreader',serif;font-size:32px;line-height:1.28;color:#fff;font-weight:400">Kelola praktik Anda dengan tenang dan terorganisir.</div>
        <div style="font-size:14.5px;color:#AAB4DC;margin-top:18px;line-height:1.6;max-width:330px">Portal untuk Super Admin, Admin Klinik, dan Psikolog. Atur jadwal, pasien, dan operasional dalam satu tempat.</div>
        <div style="display:flex;gap:26px;margin-top:34px">
          <div><div style="font-size:22px;font-weight:800;color:#fff">120+</div><div style="font-size:12px;color:#8B95C0;margin-top:2px">Psikolog</div></div>
          <div><div style="font-size:22px;font-weight:800;color:#fff">15rb+</div><div style="font-size:12px;color:#8B95C0;margin-top:2px">Sesi selesai</div></div>
          <div><div style="font-size:22px;font-weight:800;color:#fff">4.9★</div><div style="font-size:12px;color:#8B95C0;margin-top:2px">Rating</div></div>
        </div>
      </div>
    </div>

    {{-- FORM PANEL --}}
    <div style="flex:1;display:flex;flex-direction:column;min-width:0;position:relative">
      <div class="auth-form-pad">
        <form method="POST" action="/login" x-data="{ showPw: false, busy: false }" @submit="busy = true" style="width:100%;max-width:380px;margin:auto">
          @csrf
          <div style="font-size:26px;font-weight:800;color:#1E2236;letter-spacing:-.01em">Selamat datang kembali</div>
          <div style="font-size:14px;color:#6B7090;margin-top:6px">Masuk ke portal Praktiqu untuk melanjutkan.</div>

          <div style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
            <div>
              <label class="lbl">Email</label>
              <input class="inp inp-blue" name="email" value="{{ old('email') }}" type="email" placeholder="nama@email.com" required>
            </div>
            <div>
              <label class="lbl">Kata Sandi</label>
              <div class="fw-blue" style="display:flex;align-items:stretch;border:1.5px solid #DDE1EC;border-radius:13px;overflow:hidden">
                <input name="password" :type="showPw ? 'text' : 'password'" placeholder="Masukkan kata sandi" required style="flex:1;padding:14px 16px;border:none;font-size:14.5px;font-family:inherit;color:#1E2236;outline:none">
                <button type="button" @click="showPw = !showPw" style="border:none;background:none;padding:0 15px;cursor:pointer;font-size:12.5px;font-weight:600;color:#425FAD" x-text="showPw ? 'Sembunyikan' : 'Lihat'">Lihat</button>
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:2px">
              <label style="display:flex;align-items:center;gap:9px;cursor:pointer;font-size:13px;color:#4A4F6B">
                <input type="checkbox" name="remember" style="width:18px;height:18px;accent-color:#425FAD"> Ingat saya
              </label>
              <button type="button" style="border:none;background:none;cursor:pointer;font-size:13px;font-weight:600;color:#425FAD">Lupa sandi?</button>
            </div>
          </div>

          <button type="submit" :disabled="busy" x-text="busy ? 'Memproses...' : 'Masuk'"
            style="width:100%;padding:15px;border-radius:14px;border:none;font-size:15px;font-weight:700;margin-top:24px;cursor:pointer;background:#425FAD;color:#fff;transition:background .2s;box-shadow:0 8px 20px -8px rgba(66,95,173,.6)">Masuk</button>

          @if ($errors->any())
            <div style="margin-top:12px;background:#FCE9E7;color:#D7453B;font-size:12.5px;font-weight:600;padding:10px 14px;border-radius:11px;text-align:center">{{ $errors->first() }}</div>
          @endif

          <div style="text-align:center;font-size:12.5px;color:#9BA0B8;margin-top:24px;line-height:1.6">Akun dibuat oleh administrator. Hubungi admin klinik Anda jika belum memiliki akses.</div>
        </form>
      </div>
    </div>
  </div>
</div>
@endsection
