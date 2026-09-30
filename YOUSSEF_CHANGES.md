# Changes made by Youssef

Branch: `Youssef`

This document explains the changes added to the logistics application and what to check when integrating them.

## 1. Account passwords

- Borrowers choose their own password and confirm it when creating an account.
- Borrowers can sign in again using their email and password.
- Passwords must contain between 12 and 128 characters and are stored as hashes.
- An existing account with a password cannot have its password replaced through public signup.
- Passwordless legacy borrower accounts can establish a password through signup.
- The Board/Superadmin account creation form accepts an initial password and confirmation. The administrator should coordinate this password with the account owner.
- The password reset form allows the administrator to edit and confirm the replacement password.

Main files: `src/components/auth/BorrowerAuthModal.tsx`, `src/app/App.tsx`, `src/worker/index.ts`.

## 2. Notifications

- Board members receive a notification when a reservation is submitted.
- Borrowers receive notifications for submission, approval, equipment collection and return.
- Borrowers with equipment still checked out receive a reminder within the hour before their return deadline.
- After the deadline, they receive an overdue reminder, limited to one per Tunis calendar day per reservation.
- The top bar includes an inbox, unread count and controls to mark notifications as read.
- While the app is open, notifications refresh every minute.
- A daily scheduled endpoint also checks return reminders. Configure `CRON_SECRET` in the deployment environment for this endpoint.

These are in-app notifications. Email and push delivery were not added. The daily scheduled check does not guarantee a reminder exactly one hour before every deadline; that check also runs when the borrower uses the app.

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
- Updated existing test fixtures for password signup and quantity-only approval.

Before the borrower-details and quantity-only changes, 8 API tests and 2 browser tests passed, along with TypeScript, lint and the production build. After the latest changes, TypeScript and the production build passed; the automated test suites were not rerun. Physical camera scanning still needs a hands-on check.

Suggested integration checks: create a borrower with a phone number, submit and approve a reservation, inspect the borrower dialog, collect a different physical unit of the requested type, try an extra unit, return units one by one, and confirm the final status and Board attribution.

## Code commits

- `be3e985`: password signup, notifications and reservation handover workflows.
- `53a588b`: borrower details and assigning material units at pickup.
