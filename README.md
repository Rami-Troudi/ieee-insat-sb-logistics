# IEEE RAS INSAT Logistics

Production logistics portal for IEEE RAS INSAT equipment borrowing and operational inventory management.

## Current architecture

- React + Vite frontend
- Vercel deployment
- Hono API
- Turso/libSQL database
- Drizzle-compatible SQL schema and migrations
- Better Auth passwordless magic-link authentication
- Brevo email delivery for magic links and staff verification codes
- Server-side request validation, rate limiting, idempotency and audit logging

The repository is now in the real-backend phase. The old mock service layer and development persona switcher have been removed from the application.

## Authentication

Members and staff do not use application passwords.

- Member registration creates or updates the server-side member record and sends a single-use magic link.
- Staff sign in through a single-use magic link, followed by the existing short-lived staff verification step before operational actions.
- Sessions are server-side and delivered through secure HTTP cookies.
- Legacy application password data is removed by the security migration.

## Borrowing lifecycle

```
Catalogue
  -> Request
  -> Human logistics review
  -> 48h allocation
  -> Physical handover
  -> Active loan
  -> Physical return inspection
  -> Closed loan
```

Formal online borrowing is limited to the equipment classes defined by the product workflow. Clearance values are recorded and changed through human operational workflows; the application does not use a client-submitted clearance value as an authorization source.

## Inventory invariants

For each inventory item:

```
total =
  available +
  allocated +
  borrowed +
  damaged +
  maintenance +
  lost
```

Individually tracked equipment also keeps one asset record per owned unit.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

Production database migrations:

```bash
npm run db:migrate
```

Production inventory seed:

```bash
npm run seed:inventory
```

The inventory seed requires `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. It validates stock conservation and individually tracked asset counts before writing data.

## Repository structure

- `src/worker/`: API, authentication, authorization, database adapter and domain RPCs
- `src/services/remote.ts`: frontend-to-production API services
- `src/features/`: member and board UI
- `drizzle/`: database migrations
- `scripts/`: production maintenance and seed scripts
- `api/[...path].ts`: Vercel serverless entrypoint
