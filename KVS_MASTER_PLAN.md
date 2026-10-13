# KingsView Solutions (KVS) — Web App Master Plan

> Living specification. Update **Status**, **Decisions** and **Progress log** as work lands.
> Last updated: 2026-10-13 · **Live at https://kingsviewsolutions.com** (K1 + K2) · **K4 built** (catalogue, inventory, purchasing, reports) — deploy from cPanel · Next: real products, SES production connection

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

### K1 — Foundation, website, shop, back office *(built 2026-10-13)*
- [x] Scaffold from the SES foundation (auth + TOTP, permission engine, nonce CSP, jobs, mail, audit, packaging, CI); KingsView branding from `Identity/` (red #B00101 / black); fresh PG13-compatible schema (`drizzle/0000_init.sql`); reference seed for production, labelled demo seed for development
- [x] Public site: home, 9 service pages each with a request form, services list, contact, privacy, shop, cart, guest checkout, private order page (`/order/<token>`; only a SHA-256 of the token is stored)
- [x] Shop: cookie cart (ids + quantities only), re-priced from the database, Ghana taxes, stock reserved under row locks, invoice issued at checkout, online order limit (GHS 20,000 default; larger orders by quotation), pickup or delivery, e-mail with the tracking link
- [x] Back office (`/admin`): dashboard; enquiries (assign, status, → customer → quotation); customers with history; quotations (catalogue + custom lines, discount, printable, e-mail, accept → order + invoice + optional job, decline); orders (confirm → ready → completed; cancel releases stock and voids the unpaid invoice; expiry job); service jobs (schedule with assignee and customer e-mail, start, complete with note, cancel); products & stock (options with price and cost, receive / count with ledger); invoices & payments (manual MoMo/bank/cash/cheque with two-step verification, never above the balance, two-person reversal, void rules); staff & roles with second-admin approval for sensitive roles; settings; audit; exports; notifications
- [x] SKUs assigned automatically (KV-<category code>-<number>, one counter, never reused or changed; 2026-10-13)
- [x] Roles: Owner, Manager, Sales & front desk, Store & stock, Technician, Accounts, Read-only auditor
- [x] Tests: 32 unit/integration/contract tests; 55 Playwright + axe browser tests (public and staff pages on desktop and mobile, checkout, enquiry, role limits, sign-in redirects, security headers) — all passing locally and in GitHub Actions (run 38356359385: checks, e2e, deploy bundle); local browser check of public pages, checkout → order page → invoice, store and sales back office

### K2 — SES link and online payments *(built 2026-10-13)*
- [x] SES contract v1, partner side (`docs/ses-link.md`): transactional outbox; HMAC-SHA256 `SES-Signature` exactly as SES verifies; retries on 429/5xx; stop + alert on other 4xx; per-entity increasing versions; manual retry and full resync. Inbound `/api/ses/events`: signature, ±300 s window, 415/413 checks, de-duplication, SES orders at cost with stock reservation, unknown or short lines rejected back to SES, fulfilment updates accepted → shipped → delivered / rejected, SES cancellations
- [x] Contract test against SES's own schemas and signature code (vendored copy, with a drift check against the SES repository when it is next to this one)
- [x] Paystack on KingsView's own account: pay the invoice balance from the private order page, HMAC-SHA512 webhook, verify-API confirmation, amount/currency checks, test-mode label; stays off until a key is set
- Found while building: SES line ids are UUIDs (the contract doc does not say so) and SES limits product names to 200 characters — both handled

### K4 — Catalogue, inventory, purchasing and reports *(built 2026-10-13; deploy from cPanel)*
- [x] Grouped side menu with the current page highlighted
- [x] Pictures for products, categories, brands and service pages (browser-side WebP, server checks by content, `~/kvs-data/uploads/media`, long-cache serving); categories with sub-categories and SKU codes, brands, tags, specifications; shop filters, sorting, SKU/brand search, galleries, schema.org data
- [x] Inventory: locations (sellable or not, default), average cost, adjustments with reasons, transfers, stocktakes with scanning, serial numbers (receipt → transfer → sale), barcodes and Code 128 labels, camera/USB scanning, reorder points with hourly alerts
- [x] Purchasing: suppliers, purchase orders (e-mail, part receipts, close short), goods receipts; reorder drafts per preferred supplier
- [x] Reports: sales, products (ABC, margin), inventory health, demand forecast, finance & tax (GRA VAT/NHIL/GETFund), purchasing, enquiries/quotations/jobs; CSVs; Monday summary e-mail (switch in Settings)
- Tests: 58 unit/integration, 112 browser. Migrations `0001_catalogue_media`, `0002_inventory_purchasing` run on deploy; new purchasing permissions reach the system roles on deploy.

### K3 — Go live
- [x] Domain + InMotion add-on domain, database, Node app, cron; GitHub repo and deploy pipeline (2026-10-13)
- [ ] Connect to SES production (SES creates the connection and shares secrets)

## 7. Open items

| # | Item | Status |
|---|---|---|
| Q1 | KingsView domain name | **Done** — `kingsviewsolutions.com` (2026-10-13) |
| Q2 | Company details for invoices (address, phone, e-mail, GRA TIN), payment instructions (MoMo number, bank) | **Done** 2026-10-13 — set as defaults, editable in Settings. VAT registration still to confirm |
| Q3 | Real product list, prices, stock | Waiting for owner (demo data until then, clearly labelled) |
| Q4 | KingsView Paystack account | Waiting for owner |
| Q5 | Data Protection Commission registration for KingsView | Waiting for owner |

## 8. Progress log

- 2026-10-13 — K4 completed (see K4). GitHub Actions builds the deploy bundle again (the repository is now public — confirm that is intended).
- 2026-10-13 — K4 (catalogue, inventory, reporting) started. Done: grouped side menu with current page highlighted; pictures for products, categories, brands and service pages (browser-side resize to WebP, server checks by content, stored in ~/kvs-data/uploads/media, long-cache serving); categories with sub-categories and SKU codes, brands, tags, specifications; shop filters, sorting, SKU/brand search, product galleries and schema.org data; service banners and galleries. 42 unit tests, 66 browser tests passing locally.
- 2026-10-13 — **Live** at https://kingsviewsolutions.com (InMotion, same account as Synclytics; Node 24, PostgreSQL `n789825_kvs`, own deploy key). Verified from outside: all public pages 200, /admin → sign-in, /dev/mailbox 404, security headers (HSTS, nonce CSP, COOP, X-Frame-Options), /api/health ok with the database, cron tick 200. Shop empty (no demo data in production). Found while deploying: cPanel Git will not clone via an SSH alias (clone in Terminal, then register), nginx cache held the old directory listing (cleared), firewall 406 for curl user agent and body-less POST (cron lines send a browser user agent and GET). Pending: owner account sign-in + two-step, test e-mail, real products.
- 2026-10-13 — Domain `kingsviewsolutions.com` and company details received: address, two phones, e-mail, TIN, MoMo and Absa bank details are the defaults and editable in Settings (separate mobile money and bank fields, second phone); used on the website, invoices, quotations, order page and e-mails.
- 2026-10-13 — GitHub billing fixed by owner; CI green on `main` (checks, e2e, deploy bundle).
- 2026-10-13 — K1 + K2 built: 32 tests passing (shop/orders/payments, quotations/jobs/roles, Paystack, SES link behaviour, SES contract, sign-in security). Local browser check: all public pages 200, guest checkout → order page with invoice and taxes, store and sales back office, no console errors.
- 2026-10-13 — Plan created. Foundation copied from SES (commit `ac7f5e0`) into `E:\Businesses\1.KingsView\KVS-Web-App`.
