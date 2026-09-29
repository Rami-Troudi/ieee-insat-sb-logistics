# Backend Domain Contract

This document supersedes the old pre-backend freeze description. The application now runs against the real production backend.

## Runtime architecture

```
Browser
  -> Vercel
  -> Hono API
  -> Turso/libSQL
```

The frontend calls the API through `src/services/remote.ts`. There is no runtime selection between mock and remote services.

## Identity

Canonical roles are:

- `MEMBER`
- `OPERATOR`
- `SUPERADMIN`

Authentication is passwordless.

- Members authenticate with Better Auth magic links.
- Staff authenticate with a magic link and then the existing short-lived staff verification code.
- Password fields are not part of the application authentication model.
- Legacy plaintext application passwords are removed by migration `0002_security_cleanup.sql`.

The server session is the source of authenticated identity. Browser local storage is not an authentication mechanism.

## Human-in-the-loop clearance

Clearance and affiliation are operational records. They are established or changed through authorized human workflows and written to the audit trail.

The application does not treat a client-submitted clearance value as an authorization source and does not block normal product workflows solely because of a clearance value. Formal equipment-class workflow rules remain separate from clearance.

## Borrowing lifecycle

```
PENDING
  -> APPROVED / PARTIALLY_APPROVED / REJECTED
  -> 48h allocation
  -> HANDED_OVER
  -> ACTIVE LOAN
  -> PARTIALLY_RETURNED / RETURNED
```

Allocation expiry restores reserved stock. Physical return is handled by the single canonical `loan.confirmReturn` RPC.

## Inventory conservation

```
totalQuantity =
  availableQuantity +
  allocatedQuantity +
  borrowedQuantity +
  damagedQuantity +
  maintenanceQuantity +
  lostQuantity
```

Individual assets must also match the item's total owned quantity and state.

## Data storage

Core transactional entities use relational tables:

- Better Auth users/sessions
- application users
- inventory
- individual inventory assets
- requests
- request lines
- audit events
- idempotency keys
- staff verification sessions

Operational records that do not require independent relational joins continue to use the typed `record_store` table.

## Testing

API tests execute against an in-memory SQLite-compatible database using the same migrations as the application. They cover authentication boundaries, request creation, request review, allocation, handover, return, inventory restoration and authorization regressions.

Mock service suites and development persona fixtures are no longer part of the application or test suite.
