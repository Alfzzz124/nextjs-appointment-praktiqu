# Data Model: Dashboard

## No New Entities

Dashboard is a read-only aggregation feature. No new database tables or entities are required. All data is read from existing entities managed by other features:

- **Session** (feature 005): session data, status, dates, client/professional/service references
- **Client** (feature 004): client data, status, practice association
- **Professional** (feature 002): professional data, practice association
- **Service** (feature 003): service name and price

## Widget Data Aggregations

### Today's Sessions

Reads from: `Session` (feature 005)
Query filters: `slotDate = today`, scoped by role (practice or professional)

### Pending Approvals

Reads from: `Session` (feature 005)
Query filters: `status = PENDING`, scoped by professionalId

### Active Clients

Reads from: `Session` (feature 005)
Query: `SELECT COUNT(DISTINCT clientId) WHERE professionalId = ? AND status IN (BOOKED, COMPLETED)`

### Statistics (Admin)

Reads from: `Session` (feature 005) and `Client` (feature 004)
Aggregations: COUNT sessions by week, COUNT active clients, COUNT new clients by month

### Upcoming Sessions (Client)

Reads from: `Session` (feature 005)
Query filters: `clientId = user AND slotDate >= today`, ordered by slotDate, LIMIT 5

### Recent History (Client)

Reads from: `Session` (feature 005)
Query filters: `clientId = user AND status = COMPLETED`, ordered by endTime DESC, LIMIT 3

## No Migrations Needed

This feature does not require any Prisma migrations or schema changes. It only reads from existing tables managed by features 002-005.
