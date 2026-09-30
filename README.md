# IEEE INSAT SB Equipment Reservations

A standalone reservation and inventory application for the IEEE INSAT Student Branch. It has its own database, account roles, asset labels, reservation workflow, and deployment configuration. It does not read or migrate RAS Logistics data.

## Local setup

Requirements: Node.js 22 or newer and npm.

    npm install
    cp .env.example .env

Set BETTER_AUTH_SECRET in .env to a random value with at least 32 characters. The example points to a fresh SQLite-compatible local database at .local/reservations.db.

    npm run db:migrate
    npm run seed:inventory

Start the API and web app in separate terminals:

    npm run dev:api
    npm run dev

Open <http://127.0.0.1:5173/app>. The first screen lets members create an account with a name, email, and password. Members can also browse equipment and select several types and quantities before signing in. Passwords are hashed by Better Auth. Optional one-time email links need the Brevo variables in .env.

To create the initial Superadmin account and generate its password, set SUPERADMIN_EMAIL in .env, then run:

    npm run bootstrap:superadmin

The command prints a random password once. Use the Admin sign in tab with that email and password. It creates the account if absent, or resets the password and assigns the role if present. It refuses RAS database URLs and requires an explicit confirmation environment variable for remote databases.

## Product flows

- Members select multiple equipment types and quantities, choose a pickup and return window, reserve personally or for an active chapter, and follow reservation status.
- Board accounts approve or decline requests, allocate individual assets, manage the equipment catalogue, print QR labels, scan collections and returns, and review the calendar and audit log.
- Superadmins manage account roles.
- The application uses USER, BOARD, and SUPERADMIN roles, Better Auth sessions, relational storage, immutable audit events, and an Africa/Tunis timezone.

## Quality gates

    npm run format:check
    npm run lint
    npm run typecheck
    npm run test
    npm run test:e2e
    npm run build

Browser tests create a fresh isolated database at .local/e2e.db; they do not use the configured development or remote database.

Deployment and operational requirements are in [docs/operations.md](docs/operations.md).
