import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { actorFor, setupDb, variant } from "./helpers";
import type { DB } from "@/server/db/client";
import { orders, sesOutbox } from "@/server/db/schema";
import { deliverSesEvent, receiveSesEvent, resyncAll, type FetchLike } from "@/server/modules/ses-link";
import { changeStock } from "@/server/modules/inventory";
import { confirmOrder, fulfilOrder, markReady } from "@/server/modules/orders";
import { EVENT_SCHEMAS, envelopeSchema, signPayload, verifySignature, type InboundEventType } from "./fixtures/ses-contract-v1";

/**
 * Contract test against SES's own validation code (contract 2026-10-v1): every event KingsView emits must pass
 * SES's envelope and data schemas and SES's signature check; events signed the way SES signs them must be accepted.
 */
const SIGN = "whsec_contract_inbound_000000001";
const VERIFY = "whsec_contract_outbound_00000002";
const CONN = "0e6d7c5b-4a39-4281-9f0e-1d2c3b4a5f6e";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => {
  Object.assign(process.env, { SES_BASE_URL: "https://ses.example.test", SES_CONNECTION_ID: CONN, SES_SIGNING_SECRET: SIGN, SES_VERIFY_SECRET: VERIFY });
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  for (const k of ["SES_BASE_URL", "SES_CONNECTION_ID", "SES_SIGNING_SECRET", "SES_VERIFY_SECRET"]) delete process.env[k];
  await close();
});

describe("KingsView ⇄ SES contract v1", () => {
  it("every outbound event passes SES's schemas and signature verification", async () => {
    const owner = await actorFor(db, "owner@kingsview.demo");
    await resyncAll(db, owner);
    await changeStock(db, owner, { variantId: (await variant(db, "KVS-ROUTER-AC")).id, mode: "receive", quantity: 2, note: "delivery" });
    // An SES order, sent exactly as SES sends it (ids, signature header), then fulfilled.
    const lineId = randomUUID();
    const body = JSON.stringify({ id: `ses_${randomUUID()}`, type: "order.fulfilment_requested", occurred_at: new Date().toISOString(), version: Date.now(), data: { order_number: "O-2026-00500", lines: [{ line_id: lineId, sku: "KVS-ROUTER-AC", quantity: 1 }] } });
    expect((await receiveSesEvent(db, body, signPayload(VERIFY, body), "application/json")).status).toBe(200);
    const [o] = await db.select().from(orders).where(eq(orders.sesOrderNumber, "O-2026-00500"));
    await confirmOrder(db, owner, o!.id);
    await markReady(db, owner, o!.id, "RIDER-12");
    await fulfilOrder(db, owner, o!.id);

    const sent: { headers: Record<string, string>; body: string }[] = [];
    const ses: FetchLike = async (_url, init) => {
      sent.push(init);
      return { status: 202, text: async () => "" };
    };
    const rows = await db.select().from(sesOutbox);
    for (const r of rows) await deliverSesEvent(db, { id: r.id }, ses);
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(["product.upserted", "stock.updated", "fulfilment.updated"]));
    for (const s of sent) {
      expect(verifySignature(SIGN, s.body, s.headers["SES-Signature"] ?? null)).toBe("ok");
      const env = envelopeSchema.parse(JSON.parse(s.body));
      EVENT_SCHEMAS[env.type as InboundEventType].parse(env.data);
    }
  });

  it("the vendored contract still matches SES (when the SES repository is next to this one)", () => {
    const sesFile = path.resolve(process.cwd(), "../../3. Synclytics/SES-Web-App/src/server/modules/integrations/contracts.ts");
    if (!existsSync(sesFile)) return; // CI: only the vendored copy is available
    const strip = (s: string) => s.slice(s.indexOf("/**\n * Partner integration contract v1"));
    const vendored = readFileSync(path.resolve(process.cwd(), "tests/fixtures/ses-contract-v1.ts"), "utf8");
    expect(strip(vendored)).toBe(strip(readFileSync(sesFile, "utf8")));
  });
});
