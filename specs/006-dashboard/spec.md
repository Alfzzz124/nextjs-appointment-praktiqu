# Feature Specification: Dashboard

**Feature Branch**: `006-dashboard`

**Created**: 2026-06-02

**Status**: Draft

**Input**: User description: "Dashboard - view dashboard overview with statistics and key metrics, view today's sessions, view upcoming sessions for client, view statistics for clinic admin, view active clients count for professional"

## Clarifications

### Session 2026-06-02

- Q: What statistics should appear on the dashboard? → A: Role-specific: Receptionist/Admin sees today's sessions count, pending approvals count, total clients today. Clinic Admin sees additional statistics: weekly session volume, revenue estimates, client growth. Professional sees their own sessions today, pending approval requests, active clients count. Client sees their upcoming sessions.
- Q: Should dashboard data be real-time or cached? → A: Dashboard loads aggregated data on page load. No real-time updates for MVP. Data is computed from existing Session and Client entities.
- Q: Can the dashboard be customized by users? → A: No. Dashboard layout is fixed per role for MVP. Widget drag-and-drop customization is deferred to a later phase.
- Q: What is the time range for "upcoming sessions"? → A: Next 7 days by default. Client can see all their future sessions beyond 7 days on their sessions page.
- Q: Should statistics include data from all practices or just the user's practice? → A: Role-scoped. Professional sees their own data. Receptionist/Admin sees their practice's data. Super Admin sees all practices.
- Q: Is there a widget for "pending approval requests"? → A: Yes. The professional dashboard shows a count of PENDING sessions awaiting their approval. Clicking opens the pending requests queue (feature 005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Dashboard Overview (Priority: P0)

All authenticated users see a dashboard tailored to their role when they log in. The dashboard provides a quick snapshot of what matters most for their daily operations.

**Why this priority**: The dashboard is the first screen users see after login. It must provide immediate value by showing the most relevant information for each role without requiring navigation.

**Independent Test**: Can be tested by logging in as each role (Receptionist, Clinic Admin, Professional, Client) and verifying the correct role-specific dashboard loads with relevant data. Delivers role-appropriate landing experience.

**Acceptance Scenarios**:

1. **Given** a Receptionist is authenticated and navigates to the dashboard, **When** the page loads, **Then** the system displays: today's session count, sessions by status (booked, pending, completed today), pending check-in list, and a quick link to the session calendar.

2. **Given** a Professional is authenticated and navigates to the dashboard, **When** the page loads, **Then** the system displays: today's sessions, pending approval requests count, active clients count, and upcoming sessions for the next 7 days.

3. **Given** a Client is authenticated and navigates to the dashboard, **When** the page loads, **Then** the system displays: upcoming sessions (next 7 days), recent session history (last 3 completed), and a quick "Book Session" action.

4. **Given** a Clinic Admin is authenticated and navigates to the dashboard, **When** the page loads, **Then** the system displays: today's sessions, weekly session volume, active clients count, pending approvals, and revenue estimates (if billing feature 011 is implemented).

---

### User Story 2 - View Today's Sessions (Priority: P0)

Staff and professionals can quickly see all sessions scheduled for today without navigating to the calendar.

**Why this priority**: "What do I have today?" is the most common first question. A prominent "today's sessions" widget eliminates the need to navigate to the calendar for a quick check.

**Independent Test**: Can be tested by viewing today's sessions and verifying all sessions with today's date are displayed with correct status. Delivers immediate day overview.

**Acceptance Scenarios**:

1. **Given** a Receptionist is on the dashboard, **When** they view the today's sessions widget, **Then** the system displays all sessions for the current date ordered by time, showing client name, professional name, service, time, and status.

2. **Given** a Professional is on the dashboard, **When** they view the today's sessions widget, **Then** the system displays only their own sessions for today.

3. **Given** there are no sessions scheduled today, **When** the widget loads, **Then** the system displays "No sessions scheduled today" with a prompt to book or check the calendar.

---

### User Story 3 - View Statistics for Clinic Admin (Priority: P1)

A Clinic Admin needs to see aggregate statistics about their practice: session volume, client counts, and trends.

**Why this priority**: Clinic Admins need visibility into practice performance without digging into reports. Dashboard statistics provide immediate operational intelligence.

**Independent Test**: Can be tested by viewing the statistics widget and verifying the numbers match aggregated data from the session and client tables. Delivers practice-level intelligence.

**Acceptance Scenarios**:

1. **Given** a Clinic Admin is on the dashboard, **When** they view the statistics widget, **Then** the system displays: total sessions this week, total sessions last week, percentage change, active clients count, new clients this month.

2. **Given** a Clinic Admin views revenue estimates, **When** billing feature 011 is implemented, **Then** the system displays estimated revenue based on completed sessions and service prices.

3. **Given** billing feature 011 is not yet implemented, **When** the revenue widget loads, **Then** the system displays a placeholder "Revenue tracking coming soon" message.

---

### User Story 4 - View Active Clients Count (Priority: P1)

A Professional needs to know how many active clients they are currently managing.

**Why this priority**: Workload awareness helps professionals manage their practice. The active client count provides a quick health indicator.

**Independent Test**: Can be tested by viewing the professional dashboard and verifying the active clients count matches clients who have had at least one BOOKED or COMPLETED session with this professional. Delivers workload context.

**Acceptance Scenarios**:

1. **Given** a Professional is on the dashboard, **When** they view the active clients widget, **Then** the system displays the count of unique clients who have had at least one BOOKED or COMPLETED session with this professional, and a link to view the client list.

2. **Given** a Professional has no clients yet, **When** the widget loads, **Then** the system displays "0 active clients" with a prompt to check incoming bookings.

---

### User Story 5 - View Upcoming Sessions for Client (Priority: P1)

A Client needs to see their upcoming sessions and recent session history.

**Why this priority**: Clients need to stay informed about their schedule. Viewing upcoming sessions on the dashboard provides quick access without navigating to a sessions page.

**Independent Test**: Can be tested by a Client viewing their dashboard and verifying upcoming sessions are shown in chronological order. Delivers schedule awareness.

**Acceptance Scenarios**:

1. **Given** a Client is on the dashboard, **When** they view the upcoming sessions widget, **Then** the system displays their next 5 sessions ordered by date, showing: date, time, service, professional name.

2. **Given** a Client has completed sessions, **When** they view the dashboard, **Then** the system also displays the last 3 completed sessions as recent history.

3. **Given** a Client has no upcoming sessions, **When** the widget loads, **Then** the system displays "No upcoming sessions" with a "Book a Session" call-to-action.

---

### Edge Cases

- What happens when there are 100+ sessions today? → Dashboard shows the first 20 with a "View All" link to the calendar. Pagination not needed on the widget.
- What happens when billing (011) is not yet implemented? → Revenue widgets show placeholder text. No broken UI or error states.
- What happens when a professional has no pending approvals? → Widget shows "0 pending" with a green checkmark indicator, not an error.
- What happens when session data is loading? → Show skeleton loading states. No blank content or spinner-only screens.
- What happens when a professional's only clients are CANCELLED/REJECTED sessions? → Active clients count only includes clients with BOOKED or COMPLETED sessions, not cancelled or rejected.
- What happens when a Super Admin logs in? → Super Admin sees an aggregate view across all practices with drill-down by practice.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a role-specific dashboard on login for all authenticated users (Super Admin, Clinic Admin, Receptionist, Professional, Client).
- **FR-002**: System MUST show a "Today's Sessions" widget for Receptionist, Clinic Admin, and Professional roles with sessions ordered by time.
- **FR-003**: System MUST show a "Pending Approvals" widget for Professional and Clinic Admin roles displaying the count of PENDING sessions awaiting approval.
- **FR-004**: System MUST show an "Active Clients" widget for Professional displaying the count of unique clients with BOOKED or COMPLETED sessions.
- **FR-005**: System MUST show a "Statistics" widget for Clinic Admin displaying: sessions this week, sessions last week, percentage change, active clients count, new clients this month.
- **FR-006**: System MUST show an "Upcoming Sessions" widget for Client displaying the next 5 upcoming sessions with date, time, service, and professional.
- **FR-007**: System MUST show a "Recent History" widget for Client displaying the last 3 completed sessions.
- **FR-008**: System MUST enforce data scoping: Professional sees only their own data; Receptionist/Admin sees practice data; Super Admin sees all data.
- **FR-009**: System MUST show a "Quick Actions" widget appropriate to each role: Receptionist (New Booking), Professional (Approve Requests), Client (Book Session).
- **FR-010**: System MUST show placeholder content for unimplemented features (billing revenue) rather than errors or blank spaces.
- **FR-011**: System MUST support Super Admin dashboard with cross-practice aggregate statistics and practice drill-down.
- **FR-012**: Dashboard data loads on page navigation without requiring a page refresh. Data is aggregated server-side for performance.

### Key Entities *(include if feature involves data)*

- **Session**: Sessions for today's view and statistics (foreign key reference from feature 005). Attributes referenced: id, slotDate, startTime, status, clientId, professionalId, serviceId.
- **Client**: Clients for active count and statistics (foreign key reference from feature 004). Attributes referenced: id, fullName, status.
- **Professional**: Professionals for data scoping (foreign key reference from feature 002). Attributes referenced: id, fullName.
- **Service**: Services for display (foreign key reference from feature 003). Attributes referenced: id, name, price.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Dashboard loads within 3 seconds for all roles on a typical network connection.
- **SC-002**: Today's sessions widget shows accurate data matching the session table within 1 second of page load.
- **SC-003**: Active clients count matches the actual count of unique clients with BOOKED or COMPLETED sessions.
- **SC-004**: Each role sees only data scoped to their permissions (no data leakage).
- **SC-005**: Dashboard renders correctly on both desktop and mobile viewports.

## Assumptions

- Dashboard is a read-only aggregated view. No data entry happens on the dashboard.
- All statistics are computed from existing Session and Client entities. No new data stores are needed.
- Super Admin dashboard aggregates across all practices and allows drill-down by practice selection.
- Revenue estimates are shown only when billing feature 011 is implemented. Until then, a placeholder is shown.
- Dashboard layout is fixed per role — no user customization for MVP.
- Timezone for all date displays follows the practice's configured timezone.