# Approved review corrections — October 2026

This implementation addresses P2 findings 6–16 from the 4 October main review and the approved engineering recommendations. It is uncommitted. No deployment or production migration was requested.

## Explicitly deferred P1 findings

All five P1 findings remain deferred at the user's direction:

1. Borrower email/name/phone sign-in remains passwordless and does not prove ownership of an existing borrower account.
2. Role promotion still changes the privileges available to existing sessions. Atomic role updates deliberately do not revoke sessions.
3. Scans still infer pickup or return from physical state. The existing three-second camera/asset suppression remains; a sustained QR can still produce checkout followed by return.
4. Automatically inferred returns still bypass the selected-reservation match that is enforced for explicit return requests.
5. Stock retirement retains its existing scheduled-window calculation and overdue-capacity limitation.

These are known deferred behaviors, not claims of protection. Guard regressions retain borrower sign-in, promotion-session and automatic cross-reservation-return behavior. The retirement-capacity function and borrower endpoint were also compared against the reviewed source.

## P2 changes

| Finding                     | Implementation                                                                                                                                                                                                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staff login limiting        | The UI's board-login endpoint has normalized account and IP buckets using the configured authentication limit. The serverless adapter supplies the platform IP; unknown production IPs share a conservative bucket.                                                                                                                                        |
| Deployment origin trust     | Full configured origins match scheme, host and port. Vercel name prefixes and arbitrary Vercel fallback trust are removed. Development/test loopback exceptions remain explicit.                                                                                                                                                                           |
| First pickup cutoff         | Manual and QR collection check the 30-minute first-pickup deadline inside their write transaction. Approval and rescheduling reject an expired first-pickup window. Additional collection for a loan already picked up remains allowed before its return deadline.                                                                                         |
| Lifecycle and authorization | Reservation DTO/list reads are side-effect free. Explicit transactional maintenance cancels never-collected expired loans before considering completion. Only loans with pickup history can complete.                                                                                                                                                      |
| Mutation/audit atomicity    | Equipment/asset creation, password/reset session deletion, role changes, reservation chapter assignment and chapter create/update/delete write their required audits in the same transaction. Role changes preserve existing promotion sessions.                                                                                                           |
| Obsolete emails             | Delivery checks current reservation state, collected/borrowed units, deadline text, account access and notification age immediately before sending. Obsolete work becomes SKIPPED.                                                                                                                                                                         |
| Concurrent email delivery   | One message is atomically claimed with an ownership token and 60-second lease. Abandoned claims recover, provider retries reuse a stable idempotency key, and accepted-but-unrecorded submissions retain their lease. Ambiguity older than 14 minutes becomes SKIPPED with DELIVERY_UNCERTAIN for operator investigation rather than automatic redelivery. |
| Staff history               | Deleting a staff identity referenced by approval/pickup/return disables access and removes sessions/credentials while retaining the named identity and historical links.                                                                                                                                                                                   |
| Complete lists              | Borrower, board, account and audit endpoints use stable 100-record offset pages. Frontend histories fetch all pages; the queue has visible 50-record navigation. Routing uses the range-aware calendar and retrieves every page in that range.                                                                                                             |
| Mobile notifications        | The inbox uses a viewport-constrained position on narrow screens.                                                                                                                                                                                                                                                                                          |
| Inactive equipment          | QR and manual pickup both support a previously approved inactive equipment type; retired/inactive/out-of-service physical units remain rejected.                                                                                                                                                                                                           |

## Approved engineering improvements

Stored selections validate object shape and positive bounded integer quantities, with storage exceptions handled. Catalogue and selection availability requests abort stale work and ignore old responses. The scanner camera uses the latest callback after selecting a reservation, preserving existing inference/deduplication. Dashboard, catalogue, selection, queue, inventory, chapters, accounts, calendar and audit views retain loading errors with retry controls. Multi-day reservation windows show both dates. Inventory has per-type QR export alongside global export.

The duplicate inline calendar was removed. Scanner and email delivery are separate feature modules, and API/format/storage helpers and reservation/pagination contracts are shared. Calendar/scanner/QR export code loads lazily. Reservation pages hydrate in three database reads (IDs, rows, lines), and inventory assignments load in bulk rather than once per asset. FullCalendar and scanner decoding remain isolated from the initial borrower bundle.

Maintenance shares a 20-second cooperative deadline across expiry, completion, reminders, delivery and cleanup. Each expiry/reconciliation pass selects at most 100 records; reminder batches use a persisted borrower cursor; delivery claims at most 25 messages and reserves provider timeout time. Database/provider requests already in progress can run until their transport/runtime timeout. Cleanup removes up to 500 records per transient category: rate buckets older than one day, idempotency keys older than seven days, and terminal/no-email notifications older than 90 days. Durable reservation and audit history is retained.

LF text attributes, migration integrity/duplicate preflight, consistent local backup and fresh-file restore tools are included. See [operations](operations.md) and [generated-artifact policy](generated-artifacts.md).

## Dependency status and verification

The lockfile was refreshed within existing dependency constraints and overrides; two obsolete packages were removed. The Tailwind animation plugin is build tooling and moved to development dependencies. The resulting production audit has zero vulnerabilities. The full audit still reports 23 high-severity development-tool entries, including Tailwind's braces chain and bundled Vercel tooling. No breaking forced upgrades or unverified transitive major overrides were applied. A clean audit for development tooling remains outstanding.

API/storage regressions, Chromium flows, lint, TypeScript, production build, formatting, fresh migration/replay, duplicate preflight and local snapshot/restore checks are recorded in the implementation report. All database verification uses disposable files or memory databases; email submissions are mocked. Deployment headers, real Brevo inbox delivery, a physical phone camera and live remote recovery remain operational checks.
