<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="csrf-token" content="{{ csrf_token() }}">
  <title>@yield('title', 'PraktiQu')</title>
  <link rel="icon" href="/praktiqu-logo.png">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
  {{-- Cap versi dari isi file: tiap deploy yang mengubah CSS otomatis dapat URL
       baru. Tanpa ini browser lama menempelkan app.css versi kemarin ke markup
       versi hari ini, dan halaman tampil tanpa style sampai user hard refresh. --}}
  @php
      $cssFile = public_path('css/app.css');
      $cssVer = is_file($cssFile) ? '?v='.substr(md5_file($cssFile), 0, 8) : '';
  @endphp
  <link rel="stylesheet" href="/css/app.css{{ $cssVer }}">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js"></script>
  @stack('head')
</head>
<body>
@yield('content')
</body>
</html>
