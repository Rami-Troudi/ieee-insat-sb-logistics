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

Local `npm run dev:api` runs maintenance on startup and every minute. API requests also enforce expiry before reservation actions. Partially collected reservations keep the checked-out units active. At the return deadline, further pickup closes; once all collected units are returned, the reservation completes even if some requested units were never collected. Configure Brevo's key and verified sender to enable emails; without them, notifications remain available in the app and queued emails are not sent. Emails cover approval, return due soon, overdue returns, and missed-pickup cancellation. Failed delivery is retried after five minutes. Outdated reminders are skipped, and each maintenance call processes up to 25 queued emails, stopping before starting another provider request after 16 seconds. Monitor the queue and increase processing capacity if reservation volume grows. A provider accepting a message followed by a database write failure can result in duplicate delivery on retry.

Run `npm run db:migrate` before deploying this code; migration `0003_notification_emails.sql` creates the persistent email queue and `0004_review_invariants.sql` adds account access/profile fields, pickup closure tracking, unique credentials and assignment constraints. No provider credentials are stored in Git.

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
