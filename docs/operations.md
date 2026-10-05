# Deployment and operations

## Create the independent application

Create a new Vercel project and a new Turso database for IEEE INSAT SB. Do not reuse the RAS Vercel project, database, authentication secret, or email sender credentials. Connect the Vercel project to this repository and use the main production branch after review.

Configure these Vercel environment variables for Production and Preview:

| Variable           | Purpose                                                               |
| ------------------ | --------------------------------------------------------------------- |
| TURSO_DATABASE_URL | URL for the new SB database                                           |
| TURSO_AUTH_TOKEN   | Token scoped to the SB database                                       |
| BETTER_AUTH_SECRET | Random secret, at least 32 characters; use a different value from RAS |
| APP_ORIGIN         | Exact HTTPS origin of this SB application                             |
| BREVO_API_KEY      | Needed for reminder emails and optional email sign-in links           |
| BREVO_SENDER_EMAIL | Verified sender address for reminder emails and magic links           |
| BREVO_SENDER_NAME  | IEEE INSAT Student Branch                                             |
| CRON_SECRET        | Secret used to authorize the scheduled return reminder job            |

Account creation and password sign-in work without Brevo. Email links need a valid sender and API key. Keep provider credentials in Vercel only; never commit them.

The maintenance endpoint `GET /api/cron/return-reminders` cancels uncollected reservations after their 30-minute pickup deadline, creates return reminders, and delivers queued emails. Calls require `Authorization: Bearer <CRON_SECRET>`.

**Production setup:** schedule this endpoint every minute. The checked-in `vercel.json` runs every minute and requires a Vercel plan supporting that frequency. For a Hobby deployment, remove the Vercel cron entry and configure an external minute scheduler that sends the Authorization header. See [Vercel scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Local `npm run dev:api` runs maintenance on startup and every minute. Manual and QR pickup enforce the first-pickup cutoff transactionally, regardless of scheduler timing. DTO reads do not run maintenance. Partially collected loans may collect additional units before their return deadline; maintenance completes a partially collected loan after that deadline only once all physically collected units are returned. Never-collected expired loans are cancelled.

Without Brevo configuration, notifications remain in the app and email work stays queued. Delivery revalidates reservation state and deadline text, checks age/access, and marks obsolete emails SKIPPED. Each message receives a 60-second lease and a stable provider idempotency key. Failed sends retry after one minute. Accepted messages whose SENT update fails keep their lease and recover with the same key. Ambiguity beyond 14 minutes is recorded as SKIPPED with `skip_reason='DELIVERY_UNCERTAIN'`; investigate provider delivery before deciding whether to send again. Provider deduplication is time-limited, so this does not claim unlimited exactly-once delivery. See [Brevo idempotency documentation](https://developers.brevo.com/docs/heterogenous-versions-batch-emails).

The whole maintenance job shares a 20-second cooperative budget, with bounded reservation/reminder batches and at most 25 email claims. A request already in progress depends on its transport/runtime timeout. Monitor repeated job errors, PENDING/SENDING backlog and DELIVERY_UNCERTAIN records. Retention deletes old rate-limit buckets (one day), idempotency records (seven days), and terminal/no-email notifications (90 days) in batches of 500. Durable loan and audit history is retained.

Configured APP_ORIGIN, VERCEL_URL and VERCEL_PROJECT_PRODUCTION_URL are exact deployment origins. Configure the actual preview URL; project-name prefixes and arbitrary `.vercel.app` hosts are rejected. Staff authentication has both IP and normalized account limits. The serverless adapter derives the IP from Vercel's platform headers; outside that adapter production requests share the unknown-IP bucket. See [Vercel request headers](https://vercel.com/docs/headers/request-headers).

Run `npm run db:migrate` before deploying this code; migration `0003_notification_emails.sql` creates the persistent email queue and `0004_review_invariants.sql` adds account access/profile fields, pickup closure tracking, unique credentials and assignment constraints. Migration `0006_email_leases_and_maintenance.sql` adds email lease/recovery fields, maintenance cursor storage and retention indexes. Apply it before running this worker version. No provider credentials are stored in Git.

## Apply schema and establish access

Run the reviewed SQL migration against the new database before routing users to the application:

    TURSO_DATABASE_URL='libsql://<new-sb-database>' TURSO_AUTH_TOKEN='…' npm run db:migrate

From a controlled operator environment, create the initial Superadmin account and generate its password:

    SUPERADMIN_EMAIL='operator@example.org' CONFIRM_SB_DATABASE=true npm run bootstrap:superadmin

Check the database URL and account email before running that command. It creates or updates exactly one account and prints a random password once. Run it again to replace that password. It does not create a public bootstrap route.

Inventory can be entered through the Board interface. The seed command contains the seven supplied equipment types and 24 individually tracked units. It is local-only unless ALLOW_REMOTE_SEED=true is explicitly set; review stock before seeding a remote database.

## Security and data boundaries

- Use a dedicated SB database and Better Auth secret. Migration and setup scripts refuse database URLs containing the RAS identifier.
- Better Auth stores account roles in the database; role fields are not accepted from sign-up requests.
- Mutating API requests require same-origin checks, session-backed role authorization, a bounded request body, and rate limiting.
- Asset tokens contain 256 bits of randomness. Scanner operations are idempotent and duplicate scans are throttled.
- Audit rows have database triggers that reject update and delete operations.
- Reservations overlap on half-open intervals: a return at 14:00 makes that asset available to another reservation starting at 14:00.
- Display, calendar boundaries, and local date-time inputs use Africa/Tunis; API values are ISO timestamps with explicit offsets.
- The browser scanner requires HTTPS in deployment and camera permission from the operator.

## Recovery and routine checks

Back up the SB Turso database through its configured provider controls. Restore into a separate database first and verify the catalogue, accounts, reservations, asset states, and audit events before switching application configuration. Do not point this application at the RAS database as a recovery shortcut.

Use /api/health for application and database reachability. Confirm account creation, member and admin sign-in, Board approval, collection scan, return scan, and calendar display in the deployed browser after any provider or domain changes.

## Preflight and tested local recovery

Before each unapplied migration, the runner checks integrity, foreign keys, duplicate active physical borrowing and duplicate provider credentials. Conflicts stop migration without deleting data. Keep a backup and investigate duplicate historical assignments/credentials explicitly before retrying.

Use a consistent read-transaction SQL snapshot from an operator environment with the SB database variables configured:

```powershell
node --env-file-if-exists=.env scripts/backup-database.mjs .local/sb-before-upgrade.sql
```

The backup tool refuses to overwrite a recovery point. It contains personal data and credentials; store it in restricted, encrypted storage. On Windows, apply appropriate directory ACLs. Verify recovery into a new local database; the restore tool refuses remote targets and existing database files:

```powershell
$env:TURSO_DATABASE_URL = 'file:.local/sb-restore-check.db'
node scripts/restore-backup.mjs .local/sb-before-upgrade.sql
node scripts/check-database.mjs
```

Restore recreates tables, data, indexes and triggers, then verifies integrity and foreign keys. Review account/loan counts and immutable audit history before any configuration switch. Restore application environment variables after the local drill. For production recovery, restore to a separate SB database using reviewed provider controls, validate it first, and switch configuration only during an authorized recovery operation. Live remote recovery was not exercised by this implementation.

## Deferred P1 behavior

All five P1 findings remain deferred: borrower account ownership, promotion-session invalidation, explicit scan modes/longer camera latching, inferred-return reservation matching, and overdue-capacity stock retirement. See [the current correction record](review-fixes.md) for the exact retained behaviors. Account disabling/password reset still revoke sessions as before; role promotion deliberately does not.
