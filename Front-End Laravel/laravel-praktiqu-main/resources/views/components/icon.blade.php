@props(['name', 'size' => 20, 'sw' => 1.8, 'stroke' => 'currentColor'])
{{-- Set ikon SVG diport verbatim dari components/DashIcons.js FE Next.js. --}}
@php
$paths = [
    'collapse'   => '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    'grid'       => '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'calendar'   => '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 3v3M16 3v3"/>',
    'encounters' => '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v3h3"/><path d="M12 8v4l2.5 1.5"/>',
    'chevron-right' => '<path d="M9 6l6 6-6 6"/>',
    'chevron-down'  => '<path d="M6 9l6 6 6-6"/>',
    'users'      => '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.8"/><path d="M18 19a5 5 0 0 0-2.5-4.3"/>',
    'users-plus' => '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M18 7.5v5M15.5 10h5"/>',
    'stethoscope'=> '<path d="M6 3v4a4 4 0 0 0 8 0V3"/><path d="M6 3H4.5M14 3h1.5"/><path d="M10 15v1a4 4 0 0 0 4 4 3.5 3.5 0 0 0 3.5-3.5V14"/><circle cx="17.5" cy="12" r="2"/>',
    'user-plus'  => '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M18 8v6M15 11h6"/>',
    'building'   => '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M12 7v6M9 10h6M4 20.5h16"/>',
    'briefcase'  => '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7"/><path d="M12 11v4M10 13h4"/>',
    'clock'      => '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    'receipt'    => '<path d="M5 3.5h14v17l-2.5-1.5L14 20.5 11.5 19 9 20.5 6.5 19 5 20.5z"/><path d="M8.5 8h7M8.5 12h5"/>',
    'file-text'  => '<path d="M6 3h7l5 5v13H6z"/><path d="M13 3v5h5"/><path d="M9 13h6M9 16h5"/>',
    'gear'       => '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2 2M7.6 16.4l-2 2M18.4 18.4l-2-2M7.6 7.6l-2-2"/>',
    'features'   => '<path d="M4 7h9M4 12h5M4 17h9"/><circle cx="16.5" cy="7" r="2.2"/><circle cx="12.5" cy="12" r="2.2"/><circle cx="16.5" cy="17" r="2.2"/>',
    'clipboard'  => '<rect x="8" y="3" width="13" height="13" rx="2"/><path d="M16 16v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"/>',
    'sun'        => '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    'expand'     => '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>',
    'external'   => '<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10"/>',
    'logout'     => '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
    'badge-check'=> '<path d="M12 3l2.2 1.6 2.7-.2.9 2.6 2.3 1.4-.9 2.6.9 2.6-2.3 1.4-.9 2.6-2.7-.2L12 21l-2.2-1.6-2.7.2-.9-2.6-2.3-1.4.9-2.6-.9-2.6 2.3-1.4.9-2.6 2.7.2z"/><path d="M9 12l2 2 4-4"/>',
    'leaf'       => '<path d="M9 3h6l-1.3 3.2H10.3z"/><path d="M7.2 9.2C5.7 11 4.5 13.2 4.5 15.5A5.5 5.5 0 0 0 10 21h4a5.5 5.5 0 0 0 5.5-5.5c0-2.3-1.2-4.5-2.7-6.3z"/><path d="M12 11.5v6M10.4 13.2h2.4a1.4 1.4 0 0 1 0 2.8H11"/>',
    'plus'       => '<path d="M12 5v14M5 12h14"/>',
    'filter'     => '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
    'import'     => '<path d="M12 16V4M8 8l4-4 4 4M4 20h16"/>',
    'search'     => '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
    'download'   => '<path d="M12 4v12M8 12l4 4 4-4M4 20h16"/>',
    'heart'      => '<path d="M12 21s-7-4.3-9.2-8.6C1.3 9.2 2.8 6 6 6c1.8 0 3.2 1 4 2.3C10.8 7 12.2 6 14 6c3.2 0 4.7 3.2 3.2 6.4C19 16.7 12 21 12 21z"/>',
    'edit'       => '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    'trash'      => '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
    'doc'        => '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 13h8M8 16h5"/>',
];
$body = $paths[$name] ?? '';
@endphp
<svg {{ $attributes->merge(['style' => "display:inline-block;vertical-align:middle;flex:none"]) }}
  width="{{ $size }}" height="{{ $size }}" viewBox="0 0 24 24" fill="none" stroke="{{ $stroke }}"
  stroke-width="{{ $sw }}" stroke-linecap="round" stroke-linejoin="round">{!! $body !!}</svg>
