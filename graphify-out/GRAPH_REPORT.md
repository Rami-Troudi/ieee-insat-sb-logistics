# Graph Report - ieee-insat-sb-logistics-rekik-pr  (2026-10-04)

## Corpus Check
- 76 files · ~81,208 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 654 nodes · 1175 edges · 73 communities (36 shown, 37 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- IEEE INSAT SB equipment reservations
- reservations.spec.ts
- e2e-setup.mjs
- seed-inventory.mjs
- IEEE INSAT SB Equipment Reservations — Design System Specification
- cn
- @fullcalendar/core
- BoardCalendar.tsx
- SearchInput.tsx
- @fullcalendar/interaction
- @fullcalendar/luxon3
- @fullcalendar/react
- @fullcalendar/timegrid
- hono
- Changes made by Youssef
- App.tsx
- compilerOptions
- luxon
- qrcode.react
- @radix-ui/react-dropdown-menu
- @zxing/browser
- TopBar.tsx
- utils.ts
- sheet.tsx
- button.tsx
- StatusBadge.tsx
- review-flows.spec.ts
- class-variance-authority
- remaining-flows.spec.ts
- new-migration.mjs
- @fullcalendar/daygrid
- check-database.mjs
- generate-fancy-equipment-icons.mjs
- devDependencies
- Deployment and operations
- scripts
- lucide-react
- schema.ts
- vercel.json
- vite-env.d.ts
- date-fns
- @hono/node-server
- @libsql/client
- @radix-ui/react-avatar
- @radix-ui/react-slot
- @radix-ui/react-tooltip
- bootstrap-superadmin.mjs
- dependencies
- react
- react-dom
- drizzle-orm
- @hookform/resolvers
- @radix-ui/react-alert-dialog
- @radix-ui/react-dialog
- @radix-ui/react-popover
- @radix-ui/react-separator
- react-hook-form
- tailwind-merge
- @tanstack/react-query
- vaul
- zod
- migrate.mjs
- review-regressions.test.ts
- domain.ts
- [...path].js

## God Nodes (most connected - your core abstractions)
1. `cn()` - 81 edges
2. `rows()` - 21 edges
3. `one()` - 18 edges
4. `scripts` - 18 edges
5. `compilerOptions` - 18 edges
6. `getReservation()` - 13 edges
7. `write()` - 13 edges
8. `Changes made by Youssef` - 13 edges
9. `write()` - 12 edges
10. `notify()` - 12 edges

## Surprising Connections (you probably didn't know these)
- `NotificationBell()` --calls--> `cn()`  [EXTRACTED]
  src/components/shared/TopBar.tsx → src/lib/utils.ts
- `DialogOverlay` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/dialog.tsx → src/lib/utils.ts
- `DialogFooter()` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/dialog.tsx → src/lib/utils.ts
- `DropdownMenuSubTrigger` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/dropdown-menu.tsx → src/lib/utils.ts
- `DropdownMenuSubContent` --calls--> `cn()`  [EXTRACTED]
  src/components/ui/dropdown-menu.tsx → src/lib/utils.ts

## Import Cycles
- None detected.

## Communities (73 total, 37 thin omitted)

### Community 0 - "IEEE INSAT SB equipment reservations"
Cohesion: 0.33
Nodes (5): IEEE INSAT SB equipment reservations, Interaction rules, Product, Product boundaries, Visual direction

### Community 2 - "e2e-setup.mjs"
Cohesion: 0.50
Nodes (3): client, databasePath, sessionsPath

### Community 3 - "seed-inventory.mjs"
Cohesion: 0.50
Nodes (3): client, products, timestamp

### Community 4 - "IEEE INSAT SB Equipment Reservations — Design System Specification"
Cohesion: 0.09
Nodes (21): 1. Brand Identity & Principles, 2. Color System & Semantic Tokens, 3. Typography & Hierarchy, 4. Spacing, Geometry & Elevation, 5. Component Implementations, 6. Accessibility & Operational Rules, Board QR Scanner Experience, Border Radius (+13 more)

### Community 5 - "cn"
Cohesion: 0.17
Nodes (19): AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter(), AlertDialogHeader(), AlertDialogOverlay, AlertDialogTitle (+11 more)

### Community 7 - "BoardCalendar.tsx"
Cohesion: 0.15
Nodes (17): Reservation, BorrowerAuthModal(), BorrowerAuthModalProps, api(), BoardCalendar(), fmtWindow(), AssetQrStickerModal(), AssetQrStickerModalProps (+9 more)

### Community 8 - "SearchInput.tsx"
Cohesion: 0.40
Nodes (4): SearchInput(), SearchInputProps, Input, InputProps

### Community 14 - "Changes made by Youssef"
Cohesion: 0.12
Nodes (16): 1. Authentication & Borrower Identification, 2. Notifications, 3. Borrower availability display, 4. Approval reserves quantities; pickup identifies materials, 5. Reservation QR, collection and returns, 6. Clickable borrower information, 7. Database migrations and integration, 8. Development and verification (+8 more)

### Community 15 - "App.tsx"
Cohesion: 0.10
Nodes (37): AccessGate(), Accounts(), AllocationCandidate, api(), ApiError, App(), AppFrame(), AuditLog() (+29 more)

### Community 16 - "compilerOptions"
Cohesion: 0.08
Nodes (25): api, DOM, DOM.Iterable, ES2022, src, vite.config.ts, compilerOptions, allowImportingTsExtensions (+17 more)

### Community 21 - "TopBar.tsx"
Cohesion: 0.19
Nodes (12): Notification, NotificationBell(), TopBar(), TopBarProps, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel (+4 more)

### Community 22 - "utils.ts"
Cohesion: 0.17
Nodes (9): AppBrand(), AppBrandProps, DesktopSidebar(), DesktopSidebarProps, LoadingSkeleton, LoadingStateProps, Metric(), MetricProps (+1 more)

### Community 23 - "sheet.tsx"
Cohesion: 0.23
Nodes (10): MobileBottomNav(), MobileBottomNavProps, SheetContent, SheetContentProps, SheetDescription, SheetFooter(), SheetHeader(), SheetOverlay (+2 more)

### Community 24 - "button.tsx"
Cohesion: 0.20
Nodes (9): EquipmentCard(), EquipmentCardProps, EquipmentItem, EmptyState(), EmptyStateProps, ErrorState(), ErrorStateProps, Button (+1 more)

### Community 25 - "StatusBadge.tsx"
Cohesion: 0.29
Nodes (8): DomainStatus, STATUS_CONFIG, StatusBadge(), StatusBadgeProps, StatusConfigItem, Badge(), BadgeProps, badgeVariants

### Community 26 - "review-flows.spec.ts"
Cohesion: 0.33
Nodes (3): database(), sessions, update()

### Community 29 - "new-migration.mjs"
Cohesion: 0.50
Nodes (3): directory, files, path

### Community 35 - "devDependencies"
Cohesion: 0.04
Nodes (49): autoprefixer, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, devDependencies (+41 more)

### Community 40 - "Deployment and operations"
Cohesion: 0.12
Nodes (14): Apply schema and establish access, Create the independent application, Deployment and operations, Recovery and routine checks, Security and data boundaries, Corrections, Project review fixes and verification, Scope and remaining verification (+6 more)

### Community 43 - "scripts"
Cohesion: 0.06
Nodes (31): name, overrides, ajv@>=7.0.0 <8.18.0, js-yaml, minimatch@>=10.0.0 <10.2.3, path-to-regexp@>=4.0.0 <6.3.0, path-to-regexp@>=8.0.0 <8.4.0, smol-toml@<1.8.0 (+23 more)

### Community 63 - "schema.ts"
Cohesion: 0.11
Nodes (18): assets, auditEvents, authAccounts, authRateLimits, authSchema, authSessions, authUsers, authVerifications (+10 more)

### Community 81 - "vercel.json"
Cohesion: 0.22
Nodes (8): maxDuration, crons, framework, functions, api/**/*.*, headers, rewrites, $schema

### Community 82 - "vite-env.d.ts"
Cohesion: 0.50
Nodes (3): *.jpg, *.png, *.svg

### Community 121 - "bootstrap-superadmin.mjs"
Cohesion: 0.50
Nodes (3): client, email, now

### Community 122 - "dependencies"
Cohesion: 0.22
Nodes (9): better-auth, clsx, dependencies, better-auth, clsx, react-router-dom, tailwindcss-animate, react-router-dom (+1 more)

### Community 157 - "review-regressions.test.ts"
Cohesion: 0.10
Nodes (34): approve(), createLoan(), loan(), pickup(), request(), sendJson(), createAuth(), isAllowedOrigin() (+26 more)

### Community 158 - "domain.ts"
Cohesion: 0.07
Nodes (63): environment, maintenance(), maintenanceTimer, server, approveReservation(), assertCanReduceCapacity(), assignApprovedReservation(), audit() (+55 more)

### Community 159 - "[...path].js"
Cohesion: 0.10
Nodes (54): approveReservation(), assertCanReduceCapacity(), assignApprovedReservation(), audit(), auditSystem(), availableQuantity(), boardDashboard(), calendarEvents() (+46 more)

## Knowledge Gaps
- **247 isolated node(s):** `sessions`, `sessions`, `sessions`, `name`, `private` (+242 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **37 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@hookform/resolvers`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@fullcalendar/core`, `@radix-ui/react-separator`, `react-hook-form`, `@fullcalendar/interaction`, `@fullcalendar/luxon3`, `@fullcalendar/react`, `@fullcalendar/timegrid`, `hono`, `tailwind-merge`, `@tanstack/react-query`, `vaul`, `luxon`, `qrcode.react`, `@radix-ui/react-dropdown-menu`, `zod`, `@zxing/browser`, `class-variance-authority`, `@fullcalendar/daygrid`, `scripts`, `lucide-react`, `date-fns`, `@hono/node-server`, `@libsql/client`, `@radix-ui/react-avatar`, `@radix-ui/react-slot`, `@radix-ui/react-tooltip`, `react`, `react-dom`, `drizzle-orm`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `scripts`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `BoardCalendar.tsx`, `SearchInput.tsx`, `App.tsx`, `TopBar.tsx`, `utils.ts`, `sheet.tsx`, `button.tsx`, `StatusBadge.tsx`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `sessions`, `sessions`, `sessions` to the rest of the system?**
  _247 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `IEEE INSAT SB Equipment Reservations — Design System Specification` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `Changes made by Youssef` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09634551495016612 - nodes in this community are weakly interconnected._