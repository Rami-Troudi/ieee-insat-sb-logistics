# Changes made by Youssef

Branch: `Youssef`

This is a historical integration note. The current implementation and explicit five-P1 deferral are recorded in [docs/review-fixes.md](docs/review-fixes.md). Historical test/audit counts below are not current verification results.

## 1. Authentication & Borrower Identification

- Borrowers remain strictly passwordless (fast name, email, phone entry).
- Sessions are maintained seamlessly without requiring credentials or passwords.
- Board/Superadmin accounts continue using their established administrative password authentication.
- Board/Superadmin password provisioning and resets are coordinated securely by administrators.

Main files: `src/components/auth/BorrowerAuthModal.tsx`, `src/app/App.tsx`, `src/worker/index.ts`.

## 2. Notifications

- Board members receive a notification when a reservation is submitted.
- Borrowers receive notifications for submission, approval, equipment collection and return.
- Borrowers with equipment still checked out receive a reminder within the hour before their return deadline.
- After the deadline, they receive an overdue reminder, limited to one per Tunis calendar day per reservation.
- The top bar includes an inbox, unread count and controls to mark notifications as read.
- While the app is open, notifications refresh every minute.
- A minute scheduled endpoint checks pickup expiry, return reminders and queued emails. Configure `CRON_SECRET` in the deployment environment for this endpoint.

In-app notifications are always available. Brevo email delivery now covers approval, return deadlines, overdue loans and missed-pickup cancellation; it requires an API key and verified sender. Push delivery was not added. A minute maintenance schedule is required in production for timely background delivery and pickup cancellation; see `docs/operations.md`.

Main files: `src/components/shared/TopBar.tsx`, `src/worker/domain.ts`, `src/worker/index.ts`, `vercel.json`, `.env.example`, `docs/operations.md`.

## 3. Borrower availability display

The borrower catalogue and selection screen show **Available** or **Unavailable** instead of the exact number of available units. Borrowers can still choose quantities, and the server checks availability for their requested time window.

This change concerns the borrower interface. The catalogue API still includes quantity information for availability calculations.

Main files: `src/components/equipment/EquipmentCard.tsx`, `src/app/App.tsx`.

## 4. Approval reserves quantities; pickup identifies materials

Previously, approval selected specific physical units. Approval now reserves the requested quantities for the time window without assigning material IDs.

Example: approving two projectors reserves two projectors. The actual projector labels are recorded only when the Board hands them over.

- Availability calculations account for approved quantities and checked-out equipment.
- Overlapping approvals are rejected if there is insufficient capacity.
- Approval no longer requires choosing physical units.
- The calendar includes approved reservations before any units have been collected.
- Pickup rejects equipment of the wrong type, unavailable units, repeat collection and quantities above the request.

Main files: `src/worker/domain.ts`, `src/worker/index.ts`, `src/app/App.tsx`.

## 5. Reservation QR, collection and returns

### Pickup with a scanner

1. After approval, the borrower opens their reservations and selects **Show Handover QR**.
2. The Board scans this reservation QR to open the reservation checklist.
3. The Board chooses **Pickup** and scans the QR sticker of each material being given.
4. Each collection attaches that physical unit to the reservation and saves the Board member and timestamp.

Opening the reservation QR alone does not mark all equipment as collected.

### Pickup from a PC

The Board can click **Mark as handed over** in the reservation list and select the labels of the units actually given. This records collection without a camera. Partial pickup is supported; unit IDs are selected at handover rather than approval.

### Return

- The Board can open the same reservation QR, choose **Return**, and scan each material.
- A material sticker can also be scanned directly to return a checked-out unit.
- Each return saves the receiving Board member and timestamp.
- The checklist shows collected and returned quantities.
- The reservation becomes **Completed** only when all requested materials have been returned.

Material collection requires an approved reservation during its pickup window. Direct material scanning for collection requires opening the reservation first.

Main files: `src/app/App.tsx`, `src/worker/domain.ts`, `src/worker/index.ts`.

## 6. Clickable borrower information

In **Board → Reservations**, click the borrower name to see:

- Full name.
- Email.
- Phone number, or **Not provided** if none is stored.
- Number of reservations with at least one actual equipment pickup, including current loans. Requests without pickup do not count.

For chapter reservations, the dialog shows the requesting member's contact details and the chapter's borrowing count.

Phone numbers are now saved in the database during borrower signup. Older phone numbers previously kept only in browser storage are not automatically recovered.

Main files: `src/app/App.tsx`, `src/worker/index.ts`, `src/worker/schema.ts`.

## 7. Database migrations and integration

Back up the target database and run:

```sh
npm ci
npm run db:migrate
npm run build
```

New migrations:

- `drizzle/0001_borrower_phone.sql`: adds the nullable phone column to the user table.
- `drizzle/0002_quantity_reservations.sql`: removes preassigned units that were never collected and releases their reserved inventory state. Actual pickup and return records are preserved; approved reservation quantities remain in place.

Apply the migrations before running the updated API. Keep `.env`, local databases and credentials out of Git. Configure `CRON_SECRET` for scheduled return reminders. Camera scanning in deployment requires HTTPS and camera permission.

The tracked serverless API bundle in `api/[...path].js` was rebuilt.

## 8. Development and verification

- Fixed the account form syntax error found during initial testing.
- Fixed Windows quoting in the build command.
- Made the browser test database path check work on Windows.
- Browser tests use API port `8789`; normal local development uses `8787`. Vite reads `API_PORT` for its proxy.
- Updated existing test fixtures for passwordless identification and quantity-only approval.

Before the borrower-details and quantity-only changes, 8 API tests and 2 browser tests passed, along with TypeScript, lint and the production build. After the latest changes, TypeScript and the production build passed; the automated test suites were not rerun. Physical camera scanning still needs a hands-on check.

Suggested integration checks: create a borrower with a phone number, submit and approve a reservation, inspect the borrower dialog, collect a different physical unit of the requested type, try an extra unit, return units one by one, and confirm the final status and Board attribution.

## Bulk QR label export

In **Board → Inventory**, each equipment type has an **Export all QR codes** button. It opens an A4 label sheet containing one QR label per physical unit of that type, including its equipment name, material code, serial number when present, and current state. Select **Print / Save as PDF** to print the sheet or save one PDF through the browser print dialog. Equipment types without units have the button disabled. Existing individual sticker exports remain available.

## Borrowing history, email reminders and pickup expiry

- The Board borrower dialog shows the latest 50 loans, dates, material types, requested/collected/returned quantities, total units collected and units still borrowed. Totals count all retained loan records, including current loans; force-deleted records are excluded.
- Approval, return reminder, overdue and missed-pickup emails use the existing Brevo sender. A persistent queue records delivery and retries provider failures after one minute. Superseded or old reminders are skipped. Migration `0003_notification_emails.sql` creates the queue.
- Reservations with no collected units are cancelled 30 minutes after scheduled pickup, releasing their quantity capacity. This applies to pending and approved requests. Partially collected reservations remain active.
- Borrowers see the policy before submitting a request and in submission/approval notifications. Automatic cancellations create a borrower notification and a system-actor audit entry.
- The development API performs maintenance every minute. Production requires a minute scheduler calling the protected maintenance endpoint, or a Vercel Pro minute cron. The checked-in cron now runs every minute; Hobby deployments need the documented external scheduler alternative. Pickup is rejected after the deadline even between scheduler runs.

## Code commits

- `be3e985`: password signup, notifications and reservation handover workflows.
- `53a588b`: borrower details and assigning material units at pickup.

## Review corrections (2 October 2026)

- Protected equipment, account and reservation deletion with transactional writes and history checks. Accounts with history can have access disabled instead of being deleted.
- Removed unsigned session-cookie fallback and restricted origin trust to configured deployments and local development ports.
- Borrower sign-in remains passwordless and can update/sign in an existing USER account without proving email ownership; this P1 behavior is explicitly deferred. Password changes and bootstrap rotation revoke sessions; role promotion keeps existing sessions.
- Added migration 0004 for pickup closure, disabled accounts, affiliation, credential uniqueness and physical assignment constraints.
- Fixed quantity availability, reserved stock retirement checks, pickup for previously approved disabled equipment, and partial-pickup completion at the return deadline.
- Fixed direct material QR routing and staff login destination, borrower status filters, calendar quantities/colors/range loading, print CSP and HTML escaping, and camera lifecycle.
- Added accessible notification history and mark-all-read, paginated reservation/account/audit/borrower lists, bulk database reads, cleanup of transient data, and bounded email batches.
- Hardened browser storage handling, asynchronous availability requests, persistent loading error feedback and local Vite host settings.
- Replaced unsafe initial ORM regeneration with numbered incremental SQL migration creation. Updated the test toolchain, CI Node version and existing formatting.
- Added API regression tests and Chromium feature tests; see docs/review-fixes.md for results and the remaining external verification requirements.
