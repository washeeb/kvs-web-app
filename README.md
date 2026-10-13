# KingsView Solutions — Web App

Public website (nine service lines with request forms), online shop with guest checkout, and a staff back office
(enquiries, customers, quotations, orders, service jobs, products and stock, invoices and payments, roles, audit),
plus the partner link to Synclytics Enterprise Systems. Plan and status: [`KVS_MASTER_PLAN.md`](KVS_MASTER_PLAN.md).

Built on the same foundation as the Synclytics platform (Next.js 16, PostgreSQL / PGlite, Drizzle, in-house auth with
two-step verification, permission engine, nonce Content-Security-Policy, PostgreSQL job queue), as a separate codebase,
database and deployment.

## Run locally

```bash
npm ci
```
```bash
npm run setup
```
```bash
npm run dev
```

`setup` creates `.env.local` with fresh secrets, migrates the embedded database and seeds demonstration data
(accounts in [`docs/demo-accounts.md`](docs/demo-accounts.md)). E-mails appear at `/dev/mailbox`.

## Checks

```bash
npm run check
```
Typecheck, lint and the unit / contract tests (`tests/`). Browser and accessibility tests (`e2e/`, Playwright + axe) run in CI.

## Docs

- [`docs/deploy-inmotion.md`](docs/deploy-inmotion.md) — hosting next to Synclytics on InMotion
- [`docs/ses-link.md`](docs/ses-link.md) — connecting to Synclytics (contract v1)
- [`docs/demo-accounts.md`](docs/demo-accounts.md) — local demo users

Brand masters are in `logo/` (from `Identity/`); `npm run brand:build` regenerates the web assets.
