# Graph Report - ieee-insat-sb-logistics  (2026-09-29)

## Corpus Check
- 38 files · ~31,827 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 417 nodes · 631 edges · 80 communities (23 shown, 57 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bc0ef1f1`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- IEEE INSAT SB equipment reservations
- reservations.spec.ts
- e2e-setup.mjs
- seed-inventory.mjs
- drizzle-kit
- eslint-plugin-react-refresh
- @fullcalendar/core
- class-variance-authority
- @fullcalendar/daygrid
- @fullcalendar/interaction
- @fullcalendar/luxon3
- @fullcalendar/react
- @fullcalendar/timegrid
- hono
- jsdom
- App.tsx
- compilerOptions
- luxon
- qrcode.react
- @radix-ui/react-dropdown-menu
- @zxing/browser
- @playwright/test
- @types/react
- vercel
- devDependencies
- Deployment and operations
- scripts
- lucide-react
- schema.ts
- vercel.json
- vite-env.d.ts
- @testing-library/jest-dom
- globals
- date-fns
- @hono/node-server
- postcss
- tailwindcss
- @testing-library/react
- @types/node
- @libsql/client
- typescript
- typescript-eslint
- vite
- @radix-ui/react-avatar
- @radix-ui/react-slot
- @radix-ui/react-tooltip
- bootstrap-superadmin.mjs
- dependencies
- react
- react-dom
- drizzle-orm
- eslint
- @hookform/resolvers
- @radix-ui/react-alert-dialog
- @radix-ui/react-dialog
- @testing-library/user-event
- @radix-ui/react-popover
- @radix-ui/react-separator
- react-hook-form
- tailwind-merge
- @tanstack/react-query
- vaul
- zod
- prettier
- @types/react-dom
- @vitejs/plugin-react
- vitest
- migrate.mjs
- eslint-plugin-react-hooks
- env.ts
- index.ts
- [...path].js

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 18 edges
2. `scripts` - 17 edges
3. `rows()` - 13 edges
4. `getReservation()` - 12 edges
5. `api()` - 12 edges
6. `getReservation()` - 11 edges
7. `one()` - 10 edges
8. `Env` - 10 edges
9. `createReservation()` - 8 edges
10. `approveReservation()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `resolveIdentity()` --calls--> `trustedAuthOrigin()`  [EXTRACTED]
  src/worker/identity.ts → src/worker/auth.ts
- `handler` --calls--> `createRuntimeEnv()`  [EXTRACTED]
  src/worker/serverless.ts → src/worker/runtime-env.ts
- `sameOrigin()` --calls--> `trustedAuthOrigin()`  [EXTRACTED]
  src/worker/security.ts → src/worker/auth.ts
- `createAuth()` --calls--> `escapeHtml()`  [EXTRACTED]
  src/worker/auth.ts → src/worker/email.ts
- `createAuth()` --calls--> `sendEmail()`  [EXTRACTED]
  src/worker/auth.ts → src/worker/email.ts

## Import Cycles
- None detected.

## Communities (80 total, 57 thin omitted)

### Community 0 - "IEEE INSAT SB equipment reservations"
Cohesion: 0.33
Nodes (5): IEEE INSAT SB equipment reservations, Interaction rules, Product, Product boundaries, Visual direction

### Community 2 - "e2e-setup.mjs"
Cohesion: 0.50
Nodes (3): client, databasePath, sessionsPath

### Community 3 - "seed-inventory.mjs"
Cohesion: 0.50
Nodes (3): client, products, timestamp

### Community 15 - "App.tsx"
Cohesion: 0.09
Nodes (33): AccessGate(), Accounts(), AllocationCandidate, api(), ApiError, App(), AppFrame(), AuditLog() (+25 more)

### Community 16 - "compilerOptions"
Cohesion: 0.08
Nodes (25): api, DOM, DOM.Iterable, ES2022, src, vite.config.ts, compilerOptions, allowImportingTsExtensions (+17 more)

### Community 35 - "devDependencies"
Cohesion: 0.29
Nodes (7): autoprefixer, @eslint/js, devDependencies, autoprefixer, @eslint/js, @types/luxon, @types/luxon

### Community 40 - "Deployment and operations"
Cohesion: 0.18
Nodes (9): Apply schema and establish access, Create the independent application, Deployment and operations, Recovery and routine checks, Security and data boundaries, IEEE INSAT SB Equipment Reservations, Local setup, Product flows (+1 more)

### Community 43 - "scripts"
Cohesion: 0.09
Nodes (21): name, private, scripts, bootstrap:superadmin, build, db:generate, db:migrate, deploy:production (+13 more)

### Community 63 - "schema.ts"
Cohesion: 0.11
Nodes (17): assets, auditEvents, authAccounts, authRateLimits, authSchema, authSessions, authUsers, authVerifications (+9 more)

### Community 81 - "vercel.json"
Cohesion: 0.25
Nodes (7): maxDuration, framework, functions, api/**/*.*, headers, rewrites, $schema

### Community 82 - "vite-env.d.ts"
Cohesion: 0.50
Nodes (3): *.jpg, *.png, *.svg

### Community 122 - "dependencies"
Cohesion: 0.22
Nodes (9): better-auth, clsx, dependencies, better-auth, clsx, react-router-dom, tailwindcss-animate, react-router-dom (+1 more)

### Community 157 - "env.ts"
Cohesion: 0.14
Nodes (20): createAuth(), AppDatabase, createDatabase(), createLibSqlClient(), environment, server, escapeHtml(), sendEmail() (+12 more)

### Community 158 - "index.ts"
Cohesion: 0.08
Nodes (50): trustedAuthOrigin(), approveReservation(), assignApprovedReservation(), audit(), AvailableAsset, boardDashboard(), calendarEvents(), cancelReservation() (+42 more)

### Community 159 - "[...path].js"
Cohesion: 0.12
Nodes (35): approveReservation(), assignApprovedReservation(), audit(), boardDashboard(), calendarEvents(), cancelReservation(), createAuth(), createDatabase() (+27 more)

## Knowledge Gaps
- **175 isolated node(s):** `sessions`, `name`, `private`, `version`, `type` (+170 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **57 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `@hookform/resolvers`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@fullcalendar/core`, `class-variance-authority`, `@fullcalendar/daygrid`, `@fullcalendar/interaction`, `@fullcalendar/luxon3`, `@fullcalendar/react`, `@fullcalendar/timegrid`, `hono`, `@radix-ui/react-separator`, `react-hook-form`, `tailwind-merge`, `luxon`, `qrcode.react`, `@radix-ui/react-dropdown-menu`, `vaul`, `zod`, `@zxing/browser`, `scripts`, `lucide-react`, `@tanstack/react-query`, `date-fns`, `@hono/node-server`, `@libsql/client`, `@radix-ui/react-avatar`, `@radix-ui/react-slot`, `@radix-ui/react-tooltip`, `react`, `react-dom`, `drizzle-orm`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `devDependencies` to `drizzle-kit`, `eslint-plugin-react-refresh`, `@testing-library/user-event`, `prettier`, `jsdom`, `@types/react-dom`, `@vitejs/plugin-react`, `vitest`, `@playwright/test`, `@types/react`, `vercel`, `eslint-plugin-react-hooks`, `scripts`, `@testing-library/jest-dom`, `globals`, `postcss`, `tailwindcss`, `@testing-library/react`, `@types/node`, `typescript`, `typescript-eslint`, `vite`, `eslint`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **What connects `sessions`, `name`, `private` to the rest of the system?**
  _175 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `App.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09080841638981174 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._
- **Should `scripts` be split into smaller, more focused modules?**
  _Cohesion score 0.09090909090909091 - nodes in this community are weakly interconnected._
- **Should `schema.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._