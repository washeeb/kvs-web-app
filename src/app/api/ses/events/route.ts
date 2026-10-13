import { getDb } from "@/server/db/client";
import { receiveSesEvent } from "@/server/modules/ses-link";

export const dynamic = "force-dynamic";

/** Synclytics (SES) → KingsView events (contract v1): order.fulfilment_requested, order.cancelled. */
export async function POST(req: Request) {
  const raw = await req.text();
  const r = await receiveSesEvent(getDb(), raw, req.headers.get("ses-signature"), req.headers.get("content-type"));
  return Response.json(r.body, { status: r.status });
}
