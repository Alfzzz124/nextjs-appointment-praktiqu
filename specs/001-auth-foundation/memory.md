# Feature Memory - 001-auth-foundation

## Scope Notes

- Authentication via WordPress credentials (Next.js issues own JWT)
- Role-based access: Admin, Professional, Client
- Progressive rate limiting on auth endpoints
- No specific healthcare compliance framework required

## Relevant Durable Memory

- Constitution III: Conventional Commits required
- Constitution IV: TDD with E2E Validation - write tests first
- Constitution V: Full CI/CD Pipeline - all checks required before merge
- API Standards: `/api/v1/{resource}` base URL, JWT Bearer auth

## Open Questions

- What are the exact WordPress table structures for user lookup?
- Are there any existing Google OAuth configurations in WordPress?

## Watchlist

- WordPress authentication endpoint integration
- JWT token storage security (httpOnly cookies preferred)
- Refresh token rotation mechanism
- Rate limiting implementation across auth endpoints

## Never Store Here

- Permanent security architecture decisions (document in/.specify/memory/DECISIONS.md)
- General bug patterns (document in docs/memory/bugs/)
- Implementation history after feature ships
