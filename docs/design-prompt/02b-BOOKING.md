# PraktiQU - Session Booking Flow
## Design Prompt

---

## Booking Flow Overview

```
Step 1: Select Professional & Service
      ↓
Step 2: Select Date & Time
      ↓
Step 3: Client Information
      ↓
Step 4: Confirmation
```

---

## Step 1: Select Professional & Service

```
┌─────────────────────────────────────────────────────────┐
│ Book Session                               [✕ Cancel]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Step 1 of 3 ─────────────────────────────────────┐ │
│  │ ○──────●──────○──────○                             │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Select Professional                                    │
│  ───────────────────────────────────────────────────   │
│                                                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │  [Photo]    │ │  [Photo]    │ │  [Photo]    │       │
│  │             │ │             │ │             │       │
│  │ Dr. Anita   │ │ Dr. Budi    │ │ Dr. Clara   │       │
│  │ Klinis      │ │ Anak&Remaja │ │ Industri    │       │
│  │             │ │             │ │             │       │
│  │ SIP: 1234   │ │ SIP: 5678   │ │ SIP: 9012   │       │
│  │             │ │             │ │             │       │
│  │ Available:  │ │ Available:  │ │ Available:  │       │
│  │ Today 2PM   │ │ Tomorrow    │ │ Today 10AM  │       │
│  │             │ │             │ │             │       │
│  │  [Select]   │ │  [Select]   │ │  [Select]   │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│                                                         │
│  Select Service Type                                   │
│  ───────────────────────────────────────────────────   │
│                                                         │
│  ○ Konseling Individual (60 min) - Rp 250.000         │
│  ○ Konseling Kelompok (90 min) - Rp 400.000           │
│  ○ Asesmen Psikologis (120 min) - Rp 500.000           │
│                                                         │
│                 [Continue →]                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Step 2: Select Date & Time

```
┌─────────────────────────────────────────────────────────┐
│ Book Session                               [✕ Cancel]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Step 2 of 3 ─────────────────────────────────────┐ │
│  │ ○──────○──────●──────○                             │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Select Date & Time                                    │
│  ───────────────────────────────────────────────────   │
│                                                         │
│  Selected Professional: Dr. Anita Kusuma               │
│  Selected Service: Konseling Individual (60 min)       │
│                                                         │
│  ┌─────────────────────┐ ┌─────────────────────────┐ │
│  │   June 2026          │ │  Available Slots        │ │
│  │ [◀] [▶]              │ │                         │ │
│  │ Su Mo Tu We Th Fr Sa  │ │  Morning:               │ │
│  │        1  2  3  4  5  │ │  ○ 09:00               │ │
│  │  6  7  8  9 10 11 12 │ │  ○ 11:00               │ │
│  │ 13 14 15 16 17 18 19 │ │                         │ │
│  │                       │ │  Afternoon:            │ │
│  │  [Available dates     │ │  ● 14:00 (selected)   │ │
│  │   highlighted]        │ │  ○ 16:00               │ │
│  │                       │ │                         │ │
│  └─────────────────────┘ │  Evening:               │ │
│                          │  ○ 18:00                │ │
│                          └─────────────────────────┘ │
│                                                         │
│              [← Back]  [Continue →]                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Step 3: Client Information

```
┌─────────────────────────────────────────────────────────┐
│ Book Session                               [✕ Cancel]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Step 3 of 3 ─────────────────────────────────────┐ │
│  │ ○──────○──────○──────●                             │ │
│  └───────────────────────────────────────────────────┘ │
│                                                         │
│  Client Information                                     │
│  ───────────────────────────────────────────────────   │
│                                                         │
│  □ New Client  ● Existing Client                       │
│                                                         │
│  ┌─ Search Client ──────────────────────────────────┐ │
│  │ 🔍 Search by name, email, or client ID...        │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Selected Client ────────────────────────────────┐ │
│  │ [Avatar] Sarah Wijaya                            │ │
│  │           Client ID: KLN-2026-0042              │ │
│  │           consent: ● Signed                      │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Session Summary ────────────────────────────────┐ │
│  │ Date: Tuesday, 3 June 2026                       │ │
│  │ Time: 14:00 - 15:00                              │ │
│  │ Professional: Dr. Anita Kusuma                   │ │
│  │ Service: Konseling Individual                    │ │
│  │ ─────────────────────────────────────────────── │ │
│  │ Total: Rp 250.000                                │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Informed Consent ──────────────────────────────┐ │
│  │ ☐ I confirm client has signed informed consent   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                         │
│              [← Back]  [Confirm Booking →]             │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Step 4: Confirmation

```
┌─────────────────────────────────────────────────────────┐
│ ✓ Booking Confirmed                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                 ✓                                       │
│           (checkmark animation)                         │
│                                                         │
│           Booking Successful!                          │
│                                                         │
│  ┌─ Booking Details ────────────────────────────────┐ │
│  │ Confirmation #: SBK-2026-0089                    │ │
│  │ ─────────────────────────────────────────────── │ │
│  │ Client: Sarah Wijaya                           │ │
│  │ Date: Tuesday, 3 June 2026                     │ │
│  │ Time: 14:00 - 15:00                             │ │
│  │ Professional: Dr. Anita Kusuma                 │ │
│  │ Service: Konseling Individual                   │ │
│  │ Status: ⏳ Pending Approval                     │ │
│  │                                                 │ │
│  │ Total: Rp 250.000                               │ │
│  └─────────────────────────────────────────────────┘ │
│                                                         │
│       [📅 Add to Calendar]   [Book Another]            │
│                                                         │
│  ────────────────────────────────────────────────────── │
│  Notification will be sent to client once approved    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Generate these screens:

1. **Booking Step 1** - Professional & service selection
2. **Booking Step 2** - Date & time picker3. **Booking Step 3** - Client info (with search)
4. **Booking Step 4** - Success confirmation
5. **New Client Form** - Inline registration during booking
6. **Calendar Picker Component** - Date selection UI
