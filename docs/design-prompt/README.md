# PraktiQU Design Prompts for Stitch

This folder contains design prompts to generate UI screens in Google Stitch.

---

## File List

| # | File | Description |
|---|------|-------------|
| 01 | [01-DASHBOARD.md](./01-DASHBOARD.md) | Dashboard with stats, quick actions, upcoming sessions |
| 02 | [02-SESSIONS.md](./02-SESSIONS.md) | Session list, calendar view, session cards |
| 02b | [02b-BOOKING.md](./02b-BOOKING.md) | Session booking wizard (3-4 steps) |
| 03 | [03-CLIENTS.md](./03-CLIENTS.md) | Client list, profile, add/edit forms |
| 04 | [04-PROFESSIONALS.md](./04-PROFESSIONALS.md) | Professional list, profile, schedule editor |
| 05 | [05-SESSION-NOTES.md](./05-SESSION-NOTES.md) | SOAP format session notes, intervention plans |
| 06 | [06-PUBLIC-BOOKING.md](./06-PUBLIC-BOOKING.md) | Client-facing public booking pages |

---

## Color Palette Reference

```
Primary:        #5046E5 (indigo)
Primary Light:  #818CF8
Success:        #22C55E (green)
Warning:        #F59E0B (amber)
Error:          #EF4444 (red)
Check-in:       #8B5CF6 (purple)
Background:     #F8FAFC
Surface:        #FFFFFF
Text Primary:   #1E293B
Text Secondary: #64748B
```

---

## Typography

- Font Family: Inter
- Weights: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)

---

## Session Status Colors

```
PENDING     → Amber (#F59E0B)
CONFIRMED   → Blue (#5046E5)
CHECK_IN    → Purple (#8B5CF6)
CHECK_OUT   → Purple (#8B5CF6)
COMPLETED   → Green (#22C55E)
REJECTED    → Red (#EF4444)
CANCELLED   → Gray (#94A3B8)
```

---

## How to Use

1. Open [Google Stitch](https://stitch.google.com)
2. Create or open your project
3. Generate screen from text
4. Copy-paste content from relevant file(s)

---

## Recommended Order for Generation

1. **Start with:** Dashboard (01-DASHBOARD.md) - overview of the system
2. **Then:** Sessions (02-SESSIONS.md) - core functionality
3. **Then:** Booking Flow (02b-BOOKING.md) - user journey
4. **Then:** Clients (03-CLIENTS.md) - client management
5. **Then:** Professionals (04-PROFESSIONALS.md) - staff management
6. **Then:** Session Notes (05-SESSION-NOTES.md) - clinical documentation
7. **Finally:** Public Booking (06-PUBLIC-BOOKING.md) - client-facing pages
