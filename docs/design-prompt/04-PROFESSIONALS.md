# PraktiQU - Professional Management Screens
## Design Prompt

---

## Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #5046E5 | Main actions |
| Success | #22C55E | Available status |
| Warning | #F59E0B | Limited availability |
| Background | #F8FAFC | Page background |
| Surface | #FFFFFF | Cards |
| Text Primary | #1E293B | Main text |
| Text Secondary | #64748B | Labels |

---

## Professional Types

| Type | Description |
|------|-------------|
| Psikolog Klinis | Clinical Psychologist |
| Psikiater | Psychiatrist |
| Psikolog Pendidikan | Educational Psychologist |
| Psikolog IO | Industrial & Organizational |
| Psikolog Anak & Remaja | Child & Adolescent |
| Psikolog Forensik | Forensic Psychologist |

---

## SIP/SIK Format

- SIP: Surat Izin Praktik (Practice License)
- Format: `XXX/YYYY/DMPM/XXXX` (varies by region)

---

## Screen 1: Professional List View

```
┌─────────────────────────────────────────────────────────┐
│ Professionals                               [+ Add]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [All] [Available Today] [By Specialty ▼]               │
│                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │             │ │             │ │             │       │
│  │  [Photo]    │ │  [Photo]    │ │  [Photo]    │       │
│  │             │ │             │ │             │       │
│  │ Dr. Anita   │ │ Dr. Budi    │ │ Dr. Clara   │       │
│  │ Klinis      │ │ Anak&Remaja │ │ IO          │       │
│  │             │ │             │ │             │       │
│  │ SIP: 1234   │ │ SIP: 5678   │ │ SIP: 9012   │       │
│  │             │ │             │ │             │       │
│  │ ①②③ [chips] │ │ ①② [chips]  │ │ ①③ [chips]  │       │
│  │             │ │             │ │             │       │
│  │ ✓ Available │ │ ⏳ Tomorrow │ │ ✓ Available │       │
│  │ Today       │ │             │ │ Today       │       │
│  │             │ │             │ │             │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │  [Photo]    │ │  [Photo]    │ │  [Photo]    │       │
│  │ Dr. Dian    │ │ Dr. Eko     │ │ Dr. Farah   │       │
│  │ Psikiater  │ │ Klinis      │ │ Forensik    │       │
│  │ SIP: 3456   │ │ SIP: 7890   │ │ SIP: 1357   │       │
│  │ ✓ Today     │ │ ⏳ May 30   │ │ ✗ Unavailable│       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                         │
│  [Grid View] [List View]                                │
│  ──────────────────────────────────────────────────────│
│  Showing 1-6 of 8 professionals                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Screen 2: Professional Profile

```
┌─────────────────────────────────────────────────────────┐
│ ← Back to Professionals                                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Header ──────────────────────────────────────────┐ │
│  │ [Avatar]          [Edit Profile] [Schedule] [⋮]   │ │
│  │                                                    │ │
│  │ Dr. Anita Kusuma, M.Psi                           │ │
│  │ Psikolog Klinis                                   │ │
│  │                                                    │ │
│  │ SIP: 123/SPPK/2024/001                            │ │
│  │                                                        │ │
│  │ 📧 dr.anita@email.com                             │ │
│  │ 📱 0812-9876-5432                                 │ │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Specialties ────────────────────────────────────┐ │
│  │ [Konseling Individual] [CBT] [Trauma]            │ │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Services Offered ───────────────────────────────┐ │
│  │ ☑ Konseling Individual (60 min) - Rp 250.000    │ │
│  │ ☑ Asesmen Psikologis (120 min) - Rp 500.000     │ │
│  └────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Availability ──────────────────────────────────┐  │
│  │                                                    │ │
│  │ Today: ✓ Available  │ 11 slots remaining        │ │
│  │ Tomorrow: ✓ Available                               │ │
│  │ Wed-Fri: Limited (2-3 slots/day)                  │ │
│  │                                                     │ │
│  │ ───────────────────────────────────────────────── │ │
│  │ [Edit Schedule →]                                 │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌─ About ─────────────────────────────────────────┐ │
│  │ Dr. Anita graduated from Universitas Indonesia    │ │
│  │ with specialization in clinical psychology.      │ │
│  │ 8 years of experience in individual counseling   │ │
│  │ and trauma recovery therapy.                     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                        │
└─────────────────────────────────────────────────────────┘
```

---

## Screen 3: Professional Schedule Editor

```
┌─────────────────────────────────────────────────────────┐
│ Edit Schedule - Dr. Anita Kusuma           [Save] [←]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Weekly Schedule ────────────────────────────────┐ │
│  │                                                     │ │
│  │ Monday    ○ Off  ● Morning □ Afternoon □ Evening   │
│  │ Tuesday   ● All Day                                │ │
│  │ Wednesday ● All Day                                │ │
│  │ Thursday  ○ Off                                    │ │
│  │ Friday    ● All Day                                │ │
│  │ Saturday  ● All Day                                │ │
│  │ Sunday    ○ Off                                    │ │
│  │                                                     │ │
│  │ Legend: ☐ = Available, ✓ = Booked, ✗ = Blocked    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Time Slots ────────────────────────────────────┐ │
│  │                                                     │ │
│  │ Slot Duration: [50 min ▾] gaps: [10 min ▾]        │ │
│  │                                                     │ │
│  │ Morning Start: [09:00 ▾]  End: [12:00 ▾]         │ │
│  │ Afternoon Start: [13:00 ▾]  End: [17:00 ▾]       │ │
│  │ Evening Start: [18:00 ▾]  End: [20:00 ▾]         │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Blocking ───────────────────────────────────────┐ │
│  │                                                     │ │
│  │ Block specific dates:                             │ │
│  │ Jun 5-7, 2026 [Reason: Conference] [+]           │ │
│  │ [Block additional dates...]                        │ │
│  │                                                     │ │
│  └─────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Availability Indicators

| Status | Icon | Color | Meaning |
|--------|------|-------|---------|
| Available Today | ✓ | Green | Can book today |
| Available Tomorrow | ⏳ | Amber | Next slot tomorrow |
| Limited | ⚠ | Amber | Few slots left |
| Unavailable | ✗ | Gray | No slots available |
| Off | ○ | Gray | Regular day off |

---

## Generate these screens:

1. **Professional List Grid** - Card grid view
2. **Professional List List** - List view with details
3. **Professional Profile** - Full profile view
4. **Professional Schedule Editor** - Weekly schedule
5. **Add/Edit Professional Modal** - New professional form
6. **Availability Indicator Component** - Status badges
