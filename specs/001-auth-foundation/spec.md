# Feature Specification: Authentication & Authorization Foundation

**Feature Branch**: `feat/001-auth-foundation`

**Created**: 2026-05-31

**Status**: Draft

**Input**: User description: "Create a feature specification for Authentication & Authorization..."

## Clarifications

### Session 2026-05-31

- Q: How should rate limiting protect authentication endpoints against brute force attacks? → A: Progressive delays with lockout (5 failed attempts → 30s delay, 10 attempts → 5min lockout). Provides defense-in-depth while remaining user-friendly for legitimate users.
- Q: What availability target should the system meet? → A: No explicit availability target (best effort). Availability requirements will be defined at the infrastructure/platform level rather than in this authentication foundation specification.
- Q: How should the Next.js backend verify passwords against WordPress? → A: WordPress remains the source of truth for credential verification. Next.js authenticates users through a dedicated WordPress authentication endpoint rather than directly verifying password hashes from the database. After successful authentication, Next.js issues and manages its own JWT access/refresh tokens for application access. Direct password hash verification against WordPress tables should be avoided to reduce coupling with WordPress internals and hashing implementation details.
- Q: Which WordPress authentication mechanism should Next.js use? → A: Custom WordPress authentication endpoint. WordPress is responsible only for credential verification and user identity lookup. After successful authentication, Next.js issues and manages its own JWT access and refresh tokens. This keeps WordPress as the identity provider while allowing Next.js to fully control application authentication, authorization, and session management.
- Q: Which healthcare compliance framework(s) should the system support? → A: No specific regulatory framework required at this time. The authentication system follows general security best practices suitable for healthcare applications, but no formal compliance certification (HIPAA, GDPR, LGPD) is mandated.

## User Scenarios & Testing

### User Story 1 - User Login (Priority: P1)

A user (any role) needs to securely authenticate to access the PraktiQu platform. The system validates credentials against WordPress, issues JWT tokens, and establishes a session.

**Why this priority**: Login is the fundamental entry point for all users. Without authentication, no other functionality can be accessed. This must work flawlessly for all user types before any other feature can be tested.

**Independent Test**: Can be fully tested by submitting valid credentials and receiving valid JWT tokens. Delivers authenticated access to the platform.

**Acceptance Scenarios**:

1. **Given** a registered user with valid credentials, **When** the user submits correct email and password, **Then** the system authenticates the user, issues an access token (15-minute expiry) and refresh token (7-day expiry), and returns user profile information including role and permissions.

2. **Given** a user with incorrect credentials, **When** the user submits wrong password, **Then** the system rejects the attempt, returns a clear error message, logs the failed attempt, and does not issue any tokens.

3. **Given** an inactive or blocked user account, **When** the user attempts to log in, **Then** the system rejects the attempt with an appropriate message indicating the account status.

4. **Given** a user who has forgotten their password, **When** the user clicks the "Forgot password?" link on the login page, **Then** the system navigates to `/forgot-password` (full reset flow is implemented in US4 P2).

---

### User Story 3 - Social Login (Google) (Priority: P2)

A user who prefers to use their Google account needs a seamless authentication option. The system must support OAuth2-based social login while maintaining role-based access control.

**Why this priority**: Social login reduces friction for new users and aligns with modern authentication expectations. It must integrate with the existing WordPress identity system.

**Independent Test**: Can be tested by initiating Google OAuth flow, completing authentication with Google, and receiving PraktiQu JWT tokens. Delivers frictionless authentication for social users.

**Acceptance Scenarios**:

1. **Given** a user without an existing PraktiQu account but with a Google account, **When** the user initiates Google login, **Then** the system redirects to Google OAuth, and upon successful Google authentication, creates or links a PraktiQu account and issues JWT tokens.

2. **Given** an existing PraktiQu user who has linked their Google account, **When** the user initiates Google login, **Then** the system authenticates against WordPress, recognizes the linked Google account, and issues JWT tokens with the user's existing role and permissions.

3. **Given** a user who attempts Google login but the Google account email is not associated with any PraktiQu account, **When** the OAuth flow completes, **Then** the system creates a new CLIENT account (default role) and issues tokens.

---

### User Story 4 - Password Management (Priority: P2)

Users need to change their own passwords for security and reset forgotten passwords. The system must securely handle password updates while maintaining audit trails.

**Why this priority**: Password management is essential for account security. Users must be able to update passwords without administrative intervention. Audit logging is required for compliance.

**Independent Test**: Can be tested by requesting a password reset email, clicking the reset link, setting a new password, and verifying the new password works. Also test password change for authenticated users.

**Acceptance Scenarios**:

1. **Given** an authenticated user who wants to change their password, **When** the user submits their current password and a new password meeting complexity requirements, **Then** the system validates the current password, updates to the new password in WordPress, invalidates existing refresh tokens, and issues new JWT tokens.

2. **Given** a user who has forgotten their password, **When** the user requests a password reset by providing their registered email, **Then** the system sends a time-limited reset link (30-minute expiry) to their email address and logs the request.

3. **Given** a user who has received a password reset email, **When** the user clicks the reset link within the valid timeframe and sets a new password, **Then** the system updates the password in WordPress, invalidates the reset token, and allows the user to log in with the new password.

4. **Given** a user who attempts to use an expired or already-used reset link, **When** the user submits the reset request, **Then** the system rejects the request with an appropriate error message.

---

### User Story 5 - Role-Based Access Control (Priority: P1)

The system must enforce role-based permissions so users can only access resources appropriate to their role. Each role has specific capabilities within the platform.

**Why this priority**: RBAC is the security foundation that ensures users see only what they should see. Without proper access control, sensitive data and actions would be exposed to unauthorized users.

**Independent Test**: Can be tested by authenticating as users with different roles and attempting to access resources restricted to specific roles. Delivers secure, role-appropriate access to platform features.

**Acceptance Scenarios**:

1. **Given** a user with SUPER_ADMIN role, **When** the user accesses administrative functions, **Then** the system grants full access to all platform features, user management, role assignment, and system configuration.

2. **Given** a user with ADMIN role, **When** the user attempts to access SUPER_ADMIN-only functions, **Then** the system denies access with an appropriate error message.

3. **Given** a user with PROFESSIONAL role, **When** the user accesses professional-specific features (appointments, client records), **Then** the system grants access to professional-level features but restricts access to administrative functions.

4. **Given** a user with RECEPTIONIST role, **When** the user attempts to access or modify billing configurations, **Then** the system denies access with an appropriate error message.

5. **Given** a user with CLIENT role, **When** the user accesses the client portal, **Then** the system grants access to view appointments, update profile, and manage their own data only.

---

### User Story 6 - Audit Logging (Priority: P2)

The system must maintain comprehensive audit trails for security and compliance purposes, particularly important for healthcare applications.

**Why this priority**: Healthcare applications require detailed audit logs for compliance and security monitoring. Audit trails enable investigation of security incidents and demonstrate regulatory compliance.

**Independent Test**: Can be tested by performing various security-sensitive operations (login, logout, password change, role changes) and verifying that each operation is logged with appropriate details. Delivers traceable security events.

**Acceptance Scenarios**:

1. **Given** a successful login event, **When** authentication completes, **Then** the system logs the event with user ID, timestamp, IP address, user agent, and authentication method (password or Google).

2. **Given** a failed login attempt, **When** authentication fails, **Then** the system logs the failed attempt with email used, timestamp, IP address, and failure reason (invalid credentials, inactive account, etc.).

3. **Given** a password change event, **When** a user successfully changes their password, **Then** the system logs the change with user ID, timestamp, IP address, and whether it was a user-initiated change or a reset.

4. **Given** a role change event, **When** an administrator modifies a user's role, **Then** the system logs the change with admin ID, target user ID, previous role, new role, timestamp, and IP address.

---

### User Story 2 - Session Management & Token Refresh (Priority: P1)

Authenticated users need to maintain their session across requests, handle token expiration gracefully, and handle concurrent device scenarios. The system must support logout, automatic token refresh, and replay-attack protection via token family revocation.

**Sub-scenarios (merger of US2 + US7)**:

1. **Given** an authenticated user with a valid refresh token, **When** the user submits a refresh request, **Then** the system issues a new access token, rotates the refresh token, and returns updated token information.

2. **Given** a user attempting to refresh with a revoked refresh token (post-logout or security event), **When** the refresh request is submitted, **Then** the system rejects the request and returns an authentication required error.

3. **Given** a user with multiple active sessions, **When** the user refreshes from one device, **Then** the system does not invalidate tokens on other devices unless explicit single-session logout is requested.

4. **Given** a refresh token that is being reused after rotation, **When** the old refresh token is submitted, **Then** the system detects the replay attack, revokes the entire token family, and forces re-authentication.

---

### Edge Cases

- **Token expiration during request**: When a user's access token expires mid-operation, the system should return a specific error indicating token expiration, allowing the client to refresh and retry.
- **Concurrent login attempts**: When the same user attempts to log in from multiple devices simultaneously, each should receive valid tokens without interfering with others.
- **Google account email mismatch**: When a user's Google email differs from their PraktiQu registered email, the system must handle account linking or creation appropriately.
- **Password reset email delivery failure**: If the email system fails to deliver the reset link, the user should receive clear guidance on retry options.
- **Role degradation**: When a user's role is demoted while they have an active session, subsequent requests should reflect the new permissions immediately.
- **Brute force protection**: Enforced per FR-019.
- **Session fixation**: The system must prevent session fixation attacks by regenerating session identifiers after authentication.
- **Rate limit exceeded**: When a user exceeds the rate limit, the system returns a 429 status with a Retry-After header indicating when to retry. The user's IP is temporarily locked out (5-minute maximum) after 10 failed attempts within 15 minutes.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a login endpoint accepting email and password credentials, authenticating against WordPress, and returning JWT access token (15-minute expiry) and refresh token (7-day expiry).

- **FR-002**: System MUST provide a logout endpoint that invalidates the refresh token and rejects subsequent requests using the old token.

- **FR-003**: System MUST provide a token refresh endpoint accepting a valid refresh token and returning a new access token and optionally a rotated refresh token.

- **FR-004**: System MUST provide a forgot password endpoint accepting an email address and sending a time-limited (30-minute) password reset link to the user's registered email.

- **FR-005**: System MUST provide a reset password endpoint accepting a valid reset token and new password, updating the password in WordPress, and invalidating the reset token.

- **FR-006**: System MUST provide a change password endpoint for authenticated users, validating the current password, updating to the new password, and invalidating existing refresh tokens.

- **FR-007**: System MUST support Google OAuth2 login flow, redirecting to Google for authentication, handling the callback, and issuing JWT tokens upon successful authentication.

- **FR-008**: System MUST implement Role-Based Access Control (RBAC) with the following roles: SUPER_ADMIN, ADMIN, PROFESSIONAL, RECEPTIONIST, CLIENT.

- **FR-009**: System MUST enforce role-based access on all protected endpoints, returning 403 Forbidden when a user lacks required role permissions.

> **Note**: All audit requirements (FR-010, FR-011, FR-012, FR-022) and US6 narrative describe the same capability set. FRs are canonical; US6 acceptance criteria map 1:1 to them.

- **FR-010**: System MUST log all authentication events with the following required fields per event type:
  - `login.success`: { userId, timestamp, ip, userAgent, method: 'password'|'google' }
  - `login.failure`: { attemptedEmail, timestamp, ip, userAgent, reason: 'invalid_credentials'|'inactive'|'locked' }
  - `logout`: { userId, timestamp, ip, refreshTokenId }
  - `token.refresh`: { userId, timestamp, ip, oldRefreshTokenId, newRefreshTokenId }
  - `token.revoke`: { userId, timestamp, ip, refreshTokenId, reason }

- **FR-011**: System MUST log all password-related events including change requests, password resets initiated, and password resets completed with user ID, timestamp, and IP address.

- **FR-012**: System MUST log all role change events with actor ID, target user ID, previous role, new role, timestamp, and IP address.

- **FR-020**: System MUST provide `PATCH /api/v1/admin/users/:id/role` restricted to SUPER_ADMIN, accepting `{ newRole: Role }` and persisting audit log per FR-012.

- **FR-021**: Audit logs MUST be retained per Constitution (AUDIT: 90 days). Access MUST be restricted to SUPER_ADMIN via `GET /api/v1/admin/audit?page=&limit=&userId=&eventType=`. PII fields (email) MUST be hashed for users not in the requesting admin's tenant.

- **FR-022**: System MUST provide `POST /api/v1/auth/register` for self-registration creating a CLIENT-role account, rate-limited per FR-019, returning 201 with `{ userId }` (no tokens issued; user must log in).

- **FR-013**: System MUST return RFC 7807 Problem Details format for all error responses with appropriate type, title, status, and detail fields.

- **FR-014**: System MUST use URL versioning with all authentication endpoints prefixed with `/api/v1/auth/`.

- **FR-015**: System MUST rotate refresh tokens upon use to prevent replay attacks, invalidating the old token after successful refresh.

- **FR-016**: System MUST provide a service-level authorization layer exposed as `AuthorizationService` with method `can(user: User, action: string, resource?: unknown): boolean`. Default implementation MUST enforce role checks from FR-008; the interface MUST allow permission-based extensions (e.g., `can(user, 'session.approve', sessionInstance)`) without changes to call sites.

- **FR-017**: System MUST validate JWT tokens on every protected request, rejecting expired or tampered tokens with appropriate error messages.

- **FR-018**: System MUST maintain role information in the JWT claims so that client applications can display role-appropriate UI without additional API calls.

- **FR-019**: System MUST implement rate limiting on authentication endpoints keyed on `(IP, email)` tuple using a sliding 15-minute window. After 5 failed attempts within the window: 30-second progressive delay. After 10 failed attempts within the window: 5-minute hard lockout with HTTP 429 + RFC 7807 `Retry-After`. Successful authentication MUST reset the counter for that `(IP, email)` tuple.

### Key Entities

- **User**: Represents an authenticated user in the system. Attributes include: unique identifier, email address, display name, role, account status (active/inactive/blocked), WordPress user ID, Google linking status, created timestamp, last login timestamp.

- **Role**: Represents a security role defining what a user can access. Roles include: SUPER_ADMIN (full system access), ADMIN (administrative functions), PROFESSIONAL (professional-specific features), RECEPTIONIST (front-desk operations), CLIENT (client portal access).

- **Role Capabilities**:
  | Action | SUPER_ADMIN | ADMIN | PROFESSIONAL | RECEPTIONIST | CLIENT |
  |--------|:-----------:|:-----:|:------------:|:------------:|:------:|
  | user.create | ✓ | ✓ | | | |
  | user.changeRole | ✓ | | | | |
  | session.create | ✓ | ✓ | ✓ | ✓ | |
  | session.approve | ✓ | ✓ | ✓ | | |
  | billing.configure | ✓ | ✓ | | | |
  | ownProfile.update | ✓ | ✓ | ✓ | ✓ | ✓ |
  | appointment.book | ✓ | ✓ | ✓ | ✓ | ✓ |

- **RefreshToken**: { id: string, userId: string, tokenHash: string (SHA-256 of raw token), issuedAt: timestamp, expiresAt: timestamp, revokedAt: timestamp|null, replacedById: string|null, deviceInfo: { userAgent, ip } }

- **AuditLog**: { id: string, eventType: enum, actorId: string|null, targetId: string|null, timestamp: ISO8601, ip: string, userAgent: string, metadata: JSON }

- **PasswordResetToken**: { id: string, userId: string, tokenHash: string (SHA-256 of raw token), issuedAt: timestamp, expiresAt: timestamp (issuedAt + 30min), usedAt: timestamp|null }

## Success Criteria

### Measurable Outcomes

- **SC-001**: Users can complete login successfully in under 3 seconds from submission to receiving tokens.

- **SC-002**: Token refresh completes in under 1 second, allowing seamless session continuation without user intervention.

- **SC-003**: Failed login attempts are logged within 1 second with complete security metadata for audit purposes.

- **SC-004**: Password reset links expire automatically after 30 minutes, and used links cannot be reused.

- **SC-005**: All authentication endpoints return RFC 7807 compliant error responses within 500ms.

- **SC-006**: Role-based access control correctly permits or denies access within 100ms of request receipt.

- **SC-007**: System handles 1000 concurrent authentication requests without degradation in response times.

- **SC-008**: All audit logs are persisted before returning success responses to prevent data loss on errors.

- **SC-009**: JWT tokens are validated on every protected request with a validation time under 50ms.

- **SC-010**: Google OAuth flow completes successfully and issues tokens within 5 seconds from clicking "Sign in with Google" to receiving PraktiQu tokens.

## Assumptions

- **WordPress Integration**: WordPress serves as the identity provider and user management source of truth. A custom WordPress REST API authentication endpoint is responsible for credential verification and user identity lookup. WordPress handles password verification internally using PHPASS hash. Next.js handles all JWT token issuance, session management, and application authorization after successful WordPress authentication. This separation keeps WordPress as the identity provider while giving Next.js full control over application authentication and session management.

- **WordPress Auth Endpoint Contract**:
  - `POST /wp-json/praktiqu/v1/authenticate` (custom route registered in WP plugin)
  - Request: `{ email: string, password: string }`
  - Response 200: `{ wpUserId: number, email: string, displayName: string, roles: string[] }`
  - Response 401: `{ code: 'invalid_credentials' }`
  - Response 403: `{ code: 'inactive' | 'blocked' }`
  - Network errors MUST be treated as 503 by Next.js.

- **WordPress → PraktiQu Role Mapping** (configurable in `prisma/role-mapping.ts`):
  | WP Role | PraktiQu Role |
  |---------|---------------|
  | `administrator` | `SUPER_ADMIN` |
  | `praktiqu_admin` | `ADMIN` |
  | `praktiqu_professional` | `PROFESSIONAL` |
  | `praktiqu_receptionist` | `RECEPTIONIST` |
  | `subscriber` (default for new Google users) | `CLIENT` |

- **Auth Library**: NextAuth.js v5 used for OAuth flow orchestration (FR-007). Custom JWT issuance/rotation still implemented directly via `jose` per FR-001/FR-015 to maintain control over token lifecycle.

- **Email Service**: The system will integrate with an email service (SMTP or transactional email provider) to send password reset links.

- **Email Delivery Failure**: If SMTP/transactional provider returns 5xx or times out (>5s), the password-reset endpoint MUST still return 200 (no user enumeration), and the reset event MUST be logged as `email.delivery_failed` for ops follow-up.

- **Token Durations**: Access token 15min, refresh token 7d, password reset link 30min. Configurable via env: `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `RESET_TOKEN_TTL`. (Cited by US1, FR-001, FR-004, SC-004.)

- **Google OAuth Configuration**: Google OAuth credentials (client ID, client secret) are available and configured in the environment. The Google OAuth redirect URI is properly configured in the Google Cloud Console.

- **Role Assignment**: Initial role assignment comes from WordPress user roles. Role mapping between WordPress roles and PraktiQu roles is configured per the table above. SUPER_ADMIN role assignment is limited to designated administrators.

- **Token Storage**: Refresh tokens stored hashed (SHA-256) in DB. Plain token never persisted. Loss of DB = all refresh tokens invalidated (users re-auth). JWT access tokens are stateless and contain only user ID + role claims. Documented in runbook.

- **Healthcare Compliance**: The authentication system follows general security best practices suitable for healthcare applications, including encryption in transit (TLS), secure token storage, comprehensive audit logging, and protection against common attacks (brute force, session hijacking, CSRF). No specific regulatory framework (HIPAA, GDPR, etc.) is currently required. Availability requirements are delegated to the infrastructure/platform level.

- **Client Application**: The Next.js frontend is responsible for storing tokens securely (httpOnly cookies or secure storage), including the access token in Authorization headers, managing token refresh before expiration, and handling logout by clearing local tokens and calling the logout endpoint.

- **Scope Boundaries**: This specification covers only authentication, authorization, and security foundations. Professional Management and Client Management are separate features that will build upon this foundation.