# PraktiQU - Dashboard Screen
## Design Prompt

---

## Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #5046E5 | Main actions, headers |
| Primary Light | #818CF8 | Hover states |
| Success | #22C55E | Completed status |
| Warning | #F59E0B | Pending status |
| Error | #EF4444 | Errors |
| Background | #F8FAFC | Page background |
| Surface | #FFFFFF | Cards |
| Text Primary | #1E293B | Main text |
| Text Secondary | #64748B | Secondary text |

---

## Typography

- Display: Inter 30px 700
- H1: Inter 24px 600
- H2: Inter 20px 600
- Body: Inter 14px 400
- Small: Inter 12px 400

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Sidebar]  │  Top Bar: [🔔] [Avatar ▾] [Clinic ▾]      │
│             │────────────────────────────────────────────│
│ 📊 Dashboard│                                            │
│ 📅 Sessions│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│ 👥 Clients │  │Today │ │Upcoming│ │Clients│ │Revenue│   │
│ 👨‍⚕️ Prof. │  │  5   │ │   8   │ │  142  │ │ RpXX │   │
│             │  └──────┘ └──────┘ └──────┘ └──────┘       │
│             │                                            │
│             │  ┌─ Quick Actions ──────────────────────┐│
│             │  │ [+ New Session] [Add Client] [📅 Cal] ││
│             │  └──────────────────────────────────────┘│
│             │                                            │
│             │  ┌─ Upcoming Sessions ───────────────────┐│
│             │  │ Time    │ Client  │ Prof. │ Status   ││
│             │  │ 09:00   │ Sarah   │ Dr.Ani│ ● Pending││
│             │  │ 10:00   │ Budi    │ Dr.Budi│ ● Confirmed│
│             │  └──────────────────────────────────────┘│
│             │                                            │
│             │  ┌─ Recent Activity ─────────────────────┐│
│             │  │ • New session booked - Sarah (2m ago) ││
│             │  │ • Client registered - Ahmad (15m)    ││
│             │  └──────────────────────────────────────┘│
└─────────────┴────────────────────────────────────────────┘
```

---

## Components

### 1. Statistics Card
- Icon + count number (large)
- Label below
- Subtle shadow
- Hover: slight elevation

### 2. Quick Action Button
- Primary color
- Icon + text
- Rounded corners (8px)

### 3. Session Table Row
- Time column
- Client name with avatar placeholder
- Professional name
- Service type badge (L/M/S indicator)
- Status badge (colored dot + text)
- Action buttons (••• menu)

### 4. Activity Item
- Timestamp (muted)
- Activity description
- User reference

---

## States

- **Loading:** Skeleton placeholders for cards and table
- **Empty:** "No sessions today" + illustration + "Book Session" button
- **Error:** Red border + retry button

---

## Generate these screens:

1. **Dashboard Desktop** - Full layout with sidebar
2. **Dashboard Mobile** - Bottom nav, stacked cards
3. **Dashboard Loading State** - Skeleton view
4. **Dashboard Empty State** - No data yet
