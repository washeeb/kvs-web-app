# KingsView Solutions (KVS) — Web App Master Plan

> Living specification. Update **Status**, **Decisions** and **Progress log** as work lands.
> Last updated: 2026-10-13 · Current milestone: **K1 — Foundation, website, shop, back office** · Next: K2 (SES link, Paystack)

---

## 1. Purpose

KingsView Solutions is a Ghanaian business offering nine service lines. The web app gives KingsView:

1. a **public website** presenting the services, with an enquiry / quotation request for each;
2. an **online shop** for physical goods (tech, networking and IT supplies; office supplies; souvenirs, uniforms and promotional items);
3. a **staff back office** for products, stock, enquiries, customers, quotations, orders, service jobs, invoices and payments, with roles, two-step login and an audit trail;
4. a **link to Synclytics Enterprise Systems (SES)** as SES's first integration partner — KingsView pushes product, cost and stock events to SES and fulfils order lines SES sends back — using SES **contract v1** (`SES-Web-App/docs/api/partner-integration-v1.md`).

### 1.1 Service lines (from KingsView)

| # | Service line | How it is sold |
|---|---|---|
| 1 | Website & software development | Enquiry → quotation → job |
| 2 | Branding & advertising | Enquiry → quotation → job |
| 3 | Design & printing | Enquiry → quotation → job (+ printed goods) |
| 4 | Sales & installation of CCTV cameras | Shop (cameras, DVRs, cables) + installation job |
| 5 | Office supplies | Shop |
| 6 | Photography & videography | Enquiry → booking (job) |
| 7 | Computer training & consultancy | Enquiry → booking (job) |
| 8 | Souvenirs, uniforms & promotional items | Shop + custom quotation (branding, quantities) |
| 9 | Sales of tech, networking & IT supplies | Shop |

## 2. Decisions so far

| Date | Decision |
|---|---|
| 2026-10-13 | Hosting: same InMotion Power (shared) account as SES, as an add-on domain with its own PostgreSQL database and Node.js app; deployed like SES (private GitHub repo → Actions → `deploy` branch → cPanel Git Version Control). **Domain still to be confirmed.** |
| 2026-10-13 | Version 1 scope: website & services, online shop, staff back office, link to SES. |
| 2026-10-13 | Payments: offline (mobile money, bank transfer, cash — recorded by staff against invoices) **and** Paystack online checkout, in test mode until KingsView's own Paystack keys are supplied. |
| 2026-10-13 | Built on the SES foundation (same stack and security controls: Next.js, PostgreSQL/PGlite, Drizzle, in-house auth with TOTP, permission engine, nonce CSP, job queue, Playwright + axe). Separate codebase, database and deployment — no data is shared with SES except through contract v1. |
| 2026-10-13 | Brand: crowned-lion logos from `Identity/` (landscape, stacked, crest); red `#B00000`-range and black. |
| 2026-10-13 | Shop customers check out as guests (name, phone, e-mail, pickup or delivery) and get a private order-tracking link; customer accounts are a later addition. |

## 3. Architecture (inherited from SES, simplified)

- **Next.js 16** modular monolith, **PostgreSQL** in production (PGlite locally/tests), **Drizzle** migrations (PG13-compatible), money in pesewas, Ghana taxes configurable (VAT 15% + NHIL 2.5% + GETFund 2.5% seeded).
- **Auth**: staff only in K1 (scrypt, DB sessions, lockout, rate limits, TOTP mandatory for privileged permissions). **Authorisation**: permission catalogue → role templates → assignments; deny by default; no self-approval.
- **Jobs**: Postgres queue (retries, dead letter) for mail, SES deliveries, Paystack verification, maintenance; cPanel cron hits `/api/cron/tick`.
- **Security**: per-request nonce CSP, HSTS, strict headers, audit log, CSV formula-injection protection.

## 4. Modules and workflows

| Module | Workflow |
|---|---|
| Website | Home, services (9 lines, each with detail + request form), shop, about, contact, privacy, help |
| Enquiries | website form → enquiry (new → contacted → quoted → won/lost), assigned to staff, linked to a service line |
| Customers | created from enquiries/orders or by staff; history of quotations, orders, jobs, invoices |
| Catalogue & stock | categories, products, options (SKU, price, cost, stock tracking), stock adjustments with ledger, low-stock list |
| Shop | cart (cookie, ids + quantities only) → checkout (guest) → order + stock reservation + invoice → pay online (Paystack) or offline → staff confirm → ready → collected/delivered |
| Quotations | staff build quotations (products and custom lines) → send (printable / e-mail) → accepted → order and/or job |
| Service jobs | booking for installation, shoots, training, design work: requested → scheduled (date, place, assignee) → in progress → completed / cancelled |
| Invoices & payments | invoice per order/quotation; manual payments (MoMo, bank, cash, cheque) with MFA and two-person reversal; Paystack online |
| SES link (K2) | outbox of signed events to SES (`product.upserted`, `price.updated`, `stock.updated`, `fulfilment.updated`); inbound endpoint verifying SES signatures for `order.fulfilment_requested` / `order.cancelled` → SES orders appear in the back office for fulfilment |
| Admin | users, roles, settings (company details, taxes, payment instructions, SES link), audit log |

## 5. Roles (seeded)

Owner / Administrator · Manager · Sales & front desk · Store & stock · Technician / field staff · Accounts · Read-only auditor.

## 6. Milestones

### K1 — Foundation, website, shop, back office *(in progress)*
- [ ] Scaffold from SES foundation, KVS branding, fresh schema and seed
- [ ] Public site: services (9), shop, enquiry/quote forms, contact, privacy
- [ ] Shop: catalogue, cart, guest checkout, order tracking link, invoice, offline payment instructions
- [ ] Back office: dashboard, enquiries, customers, catalogue & stock, orders, quotations, jobs, invoices & payments, users & roles, settings, audit
- [ ] Tests (unit + e2e + axe), CI, docs

### K2 — SES link and online payments
- [ ] SES contract v1 partner side: signed outbox + delivery with retries, inbound SES events (signature, replay, duplicates), SES orders in the back office, fulfilment updates back to SES; contract tests against the SES endpoint format
- [ ] Paystack checkout + webhook (test mode until keys)

### K3 — Go live
- [ ] Domain + InMotion add-on domain, database, Node app, cron; GitHub repo and deploy pipeline
- [ ] Connect to SES production (SES creates the connection and shares secrets)

## 7. Open items

| # | Item | Status |
|---|---|---|
| Q1 | KingsView domain name | Waiting for owner |
| Q2 | Company details for invoices (address, phone, e-mail, GRA TIN), payment instructions (MoMo number, bank) | Waiting for owner |
| Q3 | Real product list, prices, stock | Waiting for owner (demo data until then, clearly labelled) |
| Q4 | KingsView Paystack account | Waiting for owner |
| Q5 | Data Protection Commission registration for KingsView | Waiting for owner |

## 7. Progress log

- 2026-10-13 — Plan created. Foundation copied from SES (commit `ac7f5e0`) into `E:\Businesses\1.KingsView\KVS-Web-App`.
