# Connecting KingsView to Synclytics (SES)

KingsView implements the **partner side** of SES partner integration contract **2026-10-v1**
(`SES-Web-App/docs/api/partner-integration-v1.md`). Tests: `tests/ses-link.test.ts` (behaviour) and
`tests/ses-contract.test.ts` (every event checked against SES's own schemas and signature code, vendored in
`tests/fixtures/ses-contract-v1.ts`; drift is flagged when the SES repository sits next to this one).

## What flows

| Direction | Event | When |
|---|---|---|
| KingsView → SES | `product.upserted` (name, type, tracks_stock, active, **cost** = KingsView cost price) | a product marked *Offer to Synclytics* is created or changed |
| KingsView → SES | `product.retired` | the offer is switched off |
| KingsView → SES | `stock.updated` (`on_hand` = available to promise = on hand − KingsView's own reservations, location `main`) | any stock change, sale, reservation or release |
| KingsView → SES | `fulfilment.updated` (`accepted` / `shipped` (+ dispatch ref) / `delivered` / `rejected`) | staff confirm, mark ready, complete or cancel an SES order; unknown SKUs or no stock are rejected immediately |
| SES → KingsView | `order.fulfilment_requested` | SES sells a KingsView-supplied item → appears under **Orders → From Synclytics**, priced at cost, stock reserved, invoice to Synclytics |
| SES → KingsView | `order.cancelled` | releases stock and voids the unpaid invoice |

Customer personal data never crosses: SES sends order numbers, SKUs and quantities only.

## Turning it on

1. **In SES** (Partner integrations → KingsView): create a **production** connection for KingsView, set its outbound URL to `https://kingsviewsolutions.com/api/ses/events`, and copy the connection id and the two secrets shown once.
2. **In KingsView** `.env.production`:
   - `SES_BASE_URL=https://synclyticsenterprisesystems.com`
   - `SES_CONNECTION_ID=<connection id>`
   - `SES_SIGNING_SECRET=<SES "inbound" secret>` — KingsView signs what it sends with this
   - `SES_VERIFY_SECRET=<SES "outbound" secret>` — KingsView checks what SES sends with this
   - `SES_MODE=production`
   Restart the app.
3. In KingsView, tick **Offer to Synclytics** on each product SES may sell, then **Synclytics link → Send all … again**.
4. In SES, review the new draft products, set prices (SES applies its own price rule) and publish.

## Reliability

Events are written in the same database transaction as the change, then delivered by the job queue: `202/200` = sent; `429`/`5xx`/network errors retry with back-off (8 attempts); other `4xx` stop immediately and alert users with `integrations.manage`. Failed events can be retried from **Synclytics link**. Versions increase per SKU / SKU+location / SES line, so SES ignores anything older than what it has. Incoming SES events are de-duplicated by id; signatures must be valid and within ±5 minutes.
