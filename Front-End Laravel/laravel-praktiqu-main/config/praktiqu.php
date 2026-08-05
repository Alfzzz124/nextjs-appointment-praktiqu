<?php

// Backend PraktiQU /api/v1 (lihat API-ACCESS-GUIDE.md di repo fe-praktiqu).
// Semua panggilan dilakukan server-side dari Laravel, jadi tidak ada masalah
// CORS/WAF edge seperti di FE Next.js.
return [
    'base' => env('PRAKTIQU_API_BASE', 'https://staging2.praktiqu.com'),
    // Biaya admin booking, sama dengan ADMIN di lib/booking.js FE lama.
    'admin_fee' => 5000,
];
