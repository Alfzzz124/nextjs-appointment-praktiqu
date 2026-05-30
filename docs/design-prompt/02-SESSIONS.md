# PraktiQU - Session Management Screens
## Design Prompt

---

## Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #5046E5 | Main actions |
| Success | #22C55E | Completed |
| Warning | #F59E0B | Pending |
| Error | #EF4444 | Rejected |
| Check-in | #8B5CF6 | Check-in status |
| Background | #F8FAFC | Page |
| Surface | #FFFFFF | Cards |
| Text Primary | #1E293B | Main text |
| Text Secondary | #64748B | Labels |

---

## Session Status Flow

```
PENDING (amber) → CONFIRMED (blue) → CHECK_IN (purple) → CHECK_OUT → COMPLETED (green)
      ↓
  REJECTED (red)
  CANCELLED (gray)
```

---

## Session Duration by Service

| Service | Duration |
|---------|----------|
| Konseling Individual | 60 min |
| Konseling Kelompok | 90 min |
| Asesmen Psikologis | 120 min |

---

## Screen 1: Session List View

```
┌─────────────────────────────────────────────────────────┐
│ Sessions              [+ New Session] [Calendar] [List] │
├─────────────────────────────────────────────────────────┤
│ [◀ Mon] [May 2026 ▶]  │  Filter: [Professional ▾] [Status ▾] │
├───────────────────────┼────────────────────────────────┤
│   May 2026           │                                 │
│ Mo 27 28 29 30 31 1   │  ┌─────────────────────────────┐ │
│ Tu  3  4  5  6  7  8  │  │ ● 09:00 - 10:00           │ │
│ We  5  6  7  8  9 10  │  │    Sarah Wijaya           │ │
│   ...                 │  │    Dr. Anita - Individual  │ │
│                       │  │    Status: ● Pending      │ │
│                       │  │    [View] [Approve] [✕]   │ │
│                       │  └─────────────────────────────┘ │
│                       │                                 │
│                       │  ┌─────────────────────────────┐ │
│                       │  │ ● 10:00 - 11:00           │ │
│                       │  │    Budi Santoso           │ │
│                       │  │    Dr. Budi - Assessment  │ │
│                       │  │    Status: ● Confirmed    │ │
│                       │  │    [View] [Check-in] [✕]  │ │
│                       │  └─────────────────────────────┘ │
└───────────────────────┴────────────────────────────────┘
```

---

## Screen 2: Session Detail Modal

```
┌─────────────────────────────────────────────────────────┐
│ Session Detail                              [✕ Close]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Client ─────────────────────────────────────────┐ │
│  │ [Avatar] Sarah Wijaya                             │ │
│  │              Client ID: KLN-2026-0042             │ │
│  │              Email: sarah@email.com                │ │
│  │              Phone: 0812-3456-7890               │ │
│  │              [View Profile →]                    │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Session Info ───────────────────────────────────┐ │
│  │ Date: Monday, 2 June 2026                        │ │
│  │ Time: 09:00 - 10:00 (60 min)                     │ │
│  │ Service: Konseling Individual                     │ │
│  │ Professional: Dr. Anita Kusuma, M.Psi            │ │
│  │ Status: ● Pending Approval                       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Notes ──────────────────────────────────────────┐ │
│  │ [No notes yet. Add notes after session...]      │ │
│  └─────────────────────────────────────────────────┘ │
│                                                         │
│        [Reject]                    [Approve]           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Screen 3: Session Calendar View (Weekly)

```
┌─────────────────────────────────────────────────────────┐
│ [◀ Prev Week]  Week of May 26 - Jun 1, 2026  [Next ▶]   │
├─────────────────────────────────────────────────────────┤
│ Time    │ Mon 27 │ Tue 28 │ Wed 29 │ Thu 30 │ Fri 31    │
├─────────┼────────┼────────┼────────┼────────┼───────────┤
│ 08:00   │        │ ▓▓▓▓▓  │        │        │           │
│ 09:00   │ ▓▓▓▓▓  │        │ ▓▓▓▓▓  │ ▓▓▓▓▓  │           │
│ 10:00   │        │        │        │        │           │
│ 11:00   │        │ ▓▓▓▓▓  │        │        │ ▓▓▓▓▓    │
│ 12:00   │        │        │        │        │           │
│ 13:00   │        │        │        │        │           │
│ 14:00   │        │        │        │        │           │
│ 15:00   │        │        │        │        │           │
│ 16:00   │        │        │        │        │           │
│ 17:00   │        │        │        │        │           │
└─────────┴────────┴────────┴────────┴────────┴───────────┘

Legend: ▓▓▓▓ = Session block (colored by status)
```

---

## Screen 4: Session Card Component

```
┌────────────────────────────────────┐
│ ● 09:00 - 10:00                   │
│ ─────────────────────────────────  │
│                                    │
│ [Avatar] Sarah Wijaya              │
│            Client ID: KLN-0042     │
│                                    │
│ Dr. Anita Kusuma                   │
│ Konseling Individual               │
│                                    │
│ ─────────────────────────────────  │
│ Status: ● Pending    [▾ Actions] │
└────────────────────────────────────┘

Colors by status:
- Pending: Amber background tint
- Confirmed: Blue background tint
- Check-in: Purple background tint
- Completed: Green background tint
- Cancelled: Gray background, strikethrough time
```

---

## States

- **Loading:** Card skeletons
- **Empty Day:** "No sessions scheduled" + illustration
- **Conflict:** Red border + warning icon

---

## Generate these screens:

1. **Session List** - Main list view with filters
2. **Session Calendar** - Weekly calendar grid
3. **Session Calendar Desktop** - Full week view
4. **Session Calendar Mobile** - Day view with swipe
5. **Session Detail Modal** - Booking approval view
6. **Session Card Component** - Reusable card states
