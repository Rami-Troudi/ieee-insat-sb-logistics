# Project review fixes and verification

Completed on 2 October 2026 on branch `Youssef`. This work has not been committed or deployed.

## Corrections

| Review issue                                               | Correction                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Equipment deletion could partially remove assets           | Historical references are checked before deletion; administrative writes are atomic.                                                             |
| User deletion could remove credentials before failing      | Historical users cannot be deleted; administrators can disable their access and revoke sessions.                                                 |
| Force deletion could release physically borrowed equipment | Reservations with pickup history cannot be force deleted.                                                                                        |
| Signup could claim an existing passwordless account        | Public signup rejects existing email addresses and creates credentials atomically.                                                               |
| Partial pickup and return could leave reservations stuck   | Pickup closes after the return deadline; reservations complete when no collected assets remain outstanding.                                      |
| Inventory changes could invalidate approvals               | Retirement and unavailable states check approved capacity. Disabling a material type preserves previously approved pickup.                       |
| Availability ignored approved quantity holds               | Availability subtracts overlapping approved reservations. Asset IDs remain assigned at actual pickup.                                            |
| Generated migrations did not match the custom runner       | Explicit numbered SQL migration creation replaces schema generation. The runner retains its migration journal and applies migrations atomically. |
| Unsigned session cookies were accepted                     | API identity requires Better Auth signature verification and enabled access.                                                                     |
| Authentication trusted arbitrary preview origins           | Origins are restricted to explicitly configured deployment URLs and a fixed local development allowlist.                                         |
| QR links and staff login lost navigation                   | React Router handles scan navigation and preserves the requested staff destination.                                                              |
| Borrower history omitted reservation states                | Overdue, partially returned, and declined reservations appear in the appropriate views.                                                          |
| Sticker printing violated CSP and allowed HTML injection   | Labels escape user supplied text and print after images load without inline scripts.                                                             |

Migration `0004_review_invariants.sql` adds pickup closure, membership and disabled access fields, unique credential/active borrowing constraints, and assignment consistency triggers. Existing notification migration `0003` is retained.

Additional improvements include paginated notifications/history/audit/users/reservations, bulk reservation reads, calendar window filtering, recoverable loading errors, safer local storage, camera lifecycle cleanup, lazy calendar/scanner/export loading, bounded email batches, and transient database record cleanup. Maintenance is scheduled each minute so the 30 minute pickup expiry is processed promptly. See `operations.md` for deployment scheduler requirements.

## Verification

- **32 API tests:** signed sessions, account creation, authorization, atomic rollback, capacity conflicts, deletion safety, database constraints, pickup/return completion, exact expiry boundary, notification ownership/pagination, reminder deduplication, and email retry.
- **13 Chromium browser tests:** registration and chosen password, reservation and approval, quantity selection, calendar, Board/borrower notifications, pickup, QR returns, due/overdue reminders, expiry cancellation, borrower contact/history, QR exports and printing, accounts/roles/access, chapters, camera lifecycle, pagination, and error recovery.
- The visible browser was also opened against the isolated test database to inspect Board notifications directly.
- Formatting, lint, TypeScript checks, production build, migration replay, and read-only database integrity checks were run.
- Local database checks found no foreign key errors, duplicate active borrowing, inconsistent assignments, or asset stock mismatches. A local database backup was made before applying the migration.
- Dependency updates and explicit patched transitive dependencies resolve the npm audit findings. Vercel CLI startup is checked; no deployment was performed.

## Scope and remaining verification

Browser tests use `.local/e2e.db`, dummy accounts, controlled timestamps, and a simulated camera. They do not alter production data or send real emails. Email success/failure/retry is tested with a mock provider; a real configured inbox and physical camera still require an operational check. These tests cover the implemented flows and reviewed regressions, not every possible hardware or production configuration.

Remote databases still need the normal deployment migration process. Minute cron requires an appropriate hosting plan or an external scheduler; see `operations.md`. Patched Vercel CLI dependencies are overridden because its published dependency tree includes older vulnerable versions; verify a real deployment separately when deployment is requested.
