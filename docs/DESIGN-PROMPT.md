# PraktiQU - Psychology Practice Management System
## Design Prompt for Google Stitch

---

## 1. Project Overview

**PraktiQU** is a comprehensive psychology practice management system for managing appointments, clients, professionals, and sessions in psychological practice settings.

**Target Users:**
- Clinic Admins
- Professionals (Psychologists/Psychiatrists)  
- Clients/Patients
- Receptionists

---

## 2. Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| Primary | #5046E5 | Main actions, headers, active states |
| Primary Light | #818CF8 | Hover states, secondary emphasis |
| Primary Dark | #3730A3 | Pressed states |
| Success | #22C55E | Confirmations, completed status |
| Warning | #F59E0B | Pending states, caution |
| Error | #EF4444 | Errors, rejected status |
| Background | #F8FAFC | Page backgrounds |
| Surface | #FFFFFF | Cards, modals |
| Text Primary | #1E293B | Main text |
| Text Secondary | #64748B | Secondary text, labels |

---

## 3. Typography

| Style | Font | Size | Weight |
|-------|------|------|--------|
| Display | Inter | 30px | 700 |
| H1 | Inter | 24px | 600 |
| H2 | Inter | 20px | 600 |
| H3 | Inter | 16px | 600 |
| Body | Inter | 14px | 400 |
| Small | Inter | 12px | 400 |
| Button | Inter | 14px | 500 |

---

## 4. Key Screens to Design

### A. Dashboard (Role-based)

**Layout:**
- Sidebar navigation (collapsed by default)
- Top bar with user avatar, notifications, clinic selector
- Main content area with statistics cards

**Components:**
1. Statistics Overview Cards
   - Today's Sessions (count + icon)
   - Upcoming Appointments (count + icon)
   - Total Clients (count + icon)
   - Monthly Revenue (formatted currency)

2. Quick Actions Section
   - New Session button
   - Add Client button
   - View Calendar button

3. Upcoming Sessions Table
   - Columns: Time, Client, Professional, Service, Status, Actions
   - Status badges: Pending (amber), Confirmed (blue), Completed (green)

4. Recent Activity Feed
   - Timeline-style list of recent actions

---

### B. Session List / Calendar View

**Layout:**
- Top: Date range selector, filter dropdowns (Professional, Status)
- Left sidebar: Mini calendar
- Main: Session cards in list mode OR calendar grid

**Components:**
1. Session Card
   - White card with subtle shadow
   - Time: 09:00 - 10:00
   - Client name + avatar
   - Professional name
   - Service type badge (Individual/Group/Assessment)
   - Status badge
   - Actions: View, Check-in, Cancel

2. Calendar Grid (Weekly/Monthly)
   - Time slots column
   - Session blocks colored by status
   - Empty slot indicators

3. Session Detail Modal
   - Client info card
   - Session info
   - Notes placeholder
   - Action buttons: Check-in, Check-out, Add Notes

---

### C. Session Booking Flow (3-step wizard)

**Step 1: Select Professional & Service**
- Grid of Professional cards
- Each card: Avatar, Name, Specialties, Next available slot
- Service type selector below

**Step 2: Select Date & Time**
- Calendar view (highlight available dates)
- Available time slots grid
- Duration indicator based on service

**Step 3: Client Information**
- Existing client: Search + select
- New client form: Name, Email, Phone, Consent checkbox
- Session summary card
- Confirm button

---

### D. Client Management List

**Layout:**
- Top: Search bar, Add Client button
- Filter tabs: All, Recent, By Status

**Components:**
1. Client Card/Row
   - Avatar + Unique Client ID
   - Name, Email, Phone
   - Consent status badge (Signed/Pending)
   - Last session date
   - Actions dropdown

2. Client Profile View
   - Header with avatar, name, contact info
   - Tabs: Overview, Sessions, Notes, Intervention Plans
   - Overview: Total sessions, Upcoming, Progress indicators

---

### E. Professional Management

**Layout:**
- List view with grid toggle
- Filter by: Specialty, Clinic, Availability

**Components:**
1. Professional Card
   - Photo placeholder
   - Name + Title (Psikolog Klinis, etc.)
   - SIP/SIK number
   - Specialties as chips
   - Availability: Available Today / Next available: Tomorrow

2. Professional Profile
   - Full details
   - Schedule management
   - Assigned services

---

### F. Session Note Editor

**Layout:**
- Sticky header with session info
- Tabbed content area
- Rich text editor area
- Action footer

**Components:**
1. Session Info Header
   - Client name + age
   - Session date/time
   - Service type
   - Session number (Session #3)

2. Tabbed Sections
   - Subjective: Client's description
   - Objective: Observations
   - Assessment: Analysis
   - Plan: Next steps/interventions

3. Intervention Plan Section
   - Add recommendation form
   - List of active recommendations
   - Follow-up scheduling

---

### G. Notifications Center

**Layout:**
- Dropdown from top bar
- Tabs: All, Unread

**Components:**
1. Notification Item
   - Icon (session reminder, approval, etc.)
   - Title + brief description
   - Timestamp
   - Unread indicator dot

---

### H. Public Booking Page (Client-facing)

**Layout:**
- Clean, minimal design (no sidebar)
- Hero section with clinic name
- Step wizard interface

**Screens:**
1. Welcome → Select Professional → Select Service → Select Date/Time → Enter Info → Confirmation

2. Confirmation Page
   - Success checkmark animation
   - Booking details card
   - "Add to Calendar" button
   - "Back to Home" button

---

## 5. Session Status Flow

```
PENDING (amber) → CONFIRMED (blue) → CHECK_IN (purple) → CHECK_OUT → COMPLETED (green)
      ↓
  REJECTED (red)
  CANCELLED (gray)
```

---

## 6. Key Interactions

- **Hover:** Subtle elevation + color shift
- **Active:** Pressed state with scale(0.98)
- **Loading:** Skeleton placeholders
- **Empty State:** Illustration + descriptive text + action button
- **Success:** Green checkmark animation
- **Error:** Red border + error message below field

---

## 7. Responsive Considerations

| Breakpoint | Layout |
|------------|--------|
| Desktop (1280+) | Full sidebar + content |
| Tablet (768-1279) | Collapsed sidebar + content |
| Mobile (<768) | Bottom tab nav + stacked content |

---

## 8. Specialties List (for filtering)

- Psikolog Klinis (Clinical Psychologist)
- Psikiater (Psychiatrist)
- Psikolog Pendidikan (Educational Psychologist)
- Psikolog Industri & Organisasi (I/O Psychologist)
- Psikolog Anak & Remaja (Child & Adolescent)
- Psikolog Forensik (Forensic Psychologist)

---

## 9. Service Types

| Service | Duration | Description |
|---------|----------|-------------|
| Konseling Individual | 60 min | One-on-one counseling |
| Konseling Kelompok | 90 min | Group therapy session |
| Asesmen Psikologis | 120 min | Psychological assessment |

---

Generate UI screens for this system focusing mobile-first design with clean, professional aesthetics suitable for healthcare/psychology practice context.

Pay attention to:
1. Calming color usage (not too clinical, not too casual)
2. Clear status indicators
3. Easy navigation for non-tech-savvy users (receptionists)
4. Privacy-focused design elements
5. Accessible contrast ratios
