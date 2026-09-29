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
| BREVO_API_KEY      | Optional until member sign-in email is enabled                        |
| BREVO_SENDER_EMAIL | Verified sender address for magic links                               |
| BREVO_SENDER_NAME  | IEEE INSAT Student Branch                                             |

The product can build without Brevo, but email sign-in cannot complete until a valid sender and API key are configured. Keep the provider's credentials in Vercel only; never commit them.

## Apply schema and establish access

Run the reviewed SQL migration against the new database before routing users to the application:

    TURSO_DATABASE_URL='libsql://<new-sb-database>' TURSO_AUTH_TOKEN='…' npm run db:migrate

After the application is deployed and the first authorized account has signed in, assign its Superadmin role from a controlled operator environment:

    SUPERADMIN_EMAIL='operator@example.org' CONFIRM_SB_DATABASE=true npm run bootstrap:superadmin

Check the database URL and account email before running that command. It updates exactly one existing account and does not create a public bootstrap route.

Inventory can be entered through the Board interface. The optional sample data command is local-only unless ALLOW_REMOTE_SEED=true is explicitly set; do not run sample data against a production database.

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

Use /api/health for application and database reachability. Confirm a member magic-link flow, Board approval, collection scan, return scan, and calendar display in the deployed browser after any provider or domain changes.
