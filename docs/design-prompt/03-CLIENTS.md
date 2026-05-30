# PraktiQU - Client Management Screens
## Design Prompt

---

## Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #5046E5 | Actions, links |
| Success | #22C55E | Consent signed |
| Warning | #F59E0B | Consent pending |
| Background | #F8FAFC | Page background |
| Surface | #FFFFFF | Cards |
| Text Primary | #1E293B | Main text |
| Text Secondary | #64748B | Labels |

---

## Client Unique ID Format

`KLN-YYYY-NNNN` → Example: `KLN-2026-0042`

---

## Screen 1: Client List View

```
┌─────────────────────────────────────────────────────────┐
│ Clients                     [+ Add Client] [🔍 Search] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [All] [Recent] [Consent Pending]                       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐ │
│  │ 🔍 Search by name, email, or client ID...        │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Client ──────────────────────────────────────────┐ │
│  │ [Avatar]  Sarah Wijaya           [▾ Actions]      │ │
│  │            KLN-2026-0042                         │ │
│  │            sarah@email.com • 0812-3456-7890      │ │
│  │           consent: ● Signed    Last: May 27      │ │
│  │            Total Sessions: 5                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Client ──────────────────────────────────────────┐ │
│  │ [Avatar]  Ahmad Putra             [▾ Actions]      │ │
│  │            KLN-2026-0039                         │ │
│  │            ahmad@email.com • 0813-4567-8901      │ │
│  │           consent: ● Signed    Last: May 25      │ │
│  │            Total Sessions: 3                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Client ──────────────────────────────────────────┐ │
│  │ [Avatar]  Budi Santoso            [▾ Actions]      │ │
│  │            KLN-2026-0021                         │ │
│  │            budi@email.com • 0814-5678-9012      │ │
│  │           consent: ⚠ Pending   Registered: May 20 │ │
│  │            Total Sessions: 0                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ──────────────────────────────────────────────────────│
│  Showing 1-10 of 142 clients    [<] 1 2 3 ... 15 [>] │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Screen 2: Client Profile View

```
┌─────────────────────────────────────────────────────────┐
│ ← Back to Clients                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Header ──────────────────────────────────────────┐ │
│  │ [Avatar]                                           │ │
│  │           Sarah Wijaya                            │ │
│  │           KLN-2026-0042                            │ │
│  │           sarah@email.com                          │ │
│  │           0812-3456-7890                           │ │
│  │ ─────────────────────────────────────────────────  │ │
│  │ [Edit Profile] [Send Reminder] [⋮ More]           │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  Consent: ● Signed on May 15, 2026    [View Document]  │
│                                                         │
│  ┌─ Stats ───────────────────────────────────────────┐ │
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐       │ │
│  │ │ Total     │ │ Upcoming  │ │ Progress  │       │ │
│  │ │ Sessions │ │ Sessions │ │ Score     │       │ │
│  │ │    5     │ │    1     │ │  ████░░░  │       │ │
│  │ └───────────┘ └───────────┘ └───────────┘       │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  [Overview] [Sessions] [Notes] [Plans]                │
│  ───────────────────────────────────────────────────   │
│                                                         │
│  ┌─ Overview ───────────────────────────────────────┐ │
│  │                                                   │ │
│  │ Recent Sessions:                                  │ │
│  │ ─────────────────────────────────────────────────│ │
│  │ May 27, 2026  │ Completed │ Dr. Anita   │ View →│ │
│  │ May 13, 2026  │ Completed │ Dr. Anita   │ View →│ │
│  │ Apr 29, 2026  │ Completed │ Dr. Anita   │ View →│ │
│  │                                                   │ │
│  │ Active Intervention Plans:                        │ │
│  │ ─────────────────────────────────────────────────│ │
│  │ § CBT Techniques - 4/6 sessions completed        │ │
│  │   [View Plan →]                                   │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Screen 3: Add/Edit Client Form

```
┌─────────────────────────────────────────────────────────┐
│ Add New Client                            [✕ Cancel]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Basic Information ───────────────────────────────┐ │
│  │                                                   │ │
│  │ Full Name *                                        │ │
│  │ ┌─────────────────────────────────────────────┐  │ │
│  │ │                                              │  │ │
│  │ └─────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ Email *                                           │ │
│  │ ┌─────────────────────────────────────────────┐  │ │
│  │ │                                              │  │ │
│  │ └─────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ Phone                                             │ │
│  │ ┌─────────────────────────────────────────────┐  │ │
│  │ │                                              │  │ │
│  │ └─────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ Date of Birth                                     │ │
│  │ ┌─────────────────────────────────────────────┐  │ │
│  │ │  📅 Select date                             │  │ │
│  │ └─────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  │ Notes (Optional)                                  │ │
│  │ ┌─────────────────────────────────────────────┐  │ │
│  │ │                                              │  │ │
│  │ │                                              │  │ │
│  │ └─────────────────────────────────────────────┘  │ │
│  │                                                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│        [Cancel]                    [Save Client →]     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Consent Status Display

| Status | Visual | Meaning |
|--------|--------|---------|
| Signed | ● Green badge | Consent form signed |
| Pending | ⚠ Amber badge | Awaiting consent signature |
| Not Required | ○ Gray badge | Minor / special case |

---

## Generate these screens:

1. **Client List** - Main list with search and filters
2. **Client Profile** - Overview tab view
3. **Client Sessions Tab** - Session history for client
4. **Add Client Modal** - New client registration
5. **Edit Client Modal** - Update client info
6. **Client Card Component** - Reusable list item
