# Demo accounts (development and tests only)

Created by `npm run setup` / `npm run db:seed` — **never in production** (the seed refuses when `NODE_ENV=production`).
Password: `SEED_DEMO_PASSWORD` in `.env.local` (generated per machine; not stored in the repository).

| E-mail | Role | Two-step sign-in |
|---|---|---|
| owner@kingsview.demo | Owner / Administrator | required (set up at first sign-in) |
| manager@kingsview.demo | Manager | — |
| sales@kingsview.demo | Sales & front desk | — |
| store@kingsview.demo | Store & stock | — |
| tech@kingsview.demo | Technician / field staff | — |
| accounts@kingsview.demo | Accounts | required |
| auditor@kingsview.demo | Read-only auditor | — |

The demo catalogue and records are labelled “Demonstration”; prices are illustrative, not KingsView's.
