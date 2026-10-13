"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { bool, int, run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { parseMoney } from "@/server/lib/money";
import { invalid } from "@/server/lib/errors";
import {
  adjustStock,
  cancelCount,
  cancelTransfer,
  completeCount,
  countStock,
  createTransfer,
  dispatchTransfer,
  findVariantByCode,
  receiveStock,
  receiveTransfer,
  recordCounts,
  saveLocation,
  scanIntoCount,
  startCount,
  updateStockSettings,
  type AdjustReason,
} from "@/server/modules/inventory";
import { cancelPurchaseOrder, createPurchaseOrder, draftOrdersFromReorder, receivePurchaseOrder, saveSupplier, sendPurchaseOrder } from "@/server/modules/purchasing";

type Prev = ActionState;
const staff = () => requireActor("operator");
const optInt = (fd: FormData, k: string) => (str(fd, k) === "" ? null : int(fd, k));
const optMoney = (fd: FormData, k: string) => {
  if (!str(fd, k)) return null;
  const v = parseMoney(str(fd, k));
  if (v === null) throw invalid("Enter an amount such as 125.00");
  return v;
};

/** Resolves an item typed as SKU / barcode, or chosen from a list (variant id). */
async function itemId(fd: FormData, key = "code") {
  const raw = str(fd, key);
  if (/^[0-9a-f-]{36}$/.test(raw)) return raw;
  const v = await findVariantByCode(getDb(), raw.split(" — ")[0]!);
  if (!v) throw invalid(`No item with code "${raw.slice(0, 40)}". Check the SKU or barcode.`);
  return v.id;
}

/** Rows posted as code_<n>, qty_<n> (and cost_<n>, serials_<n>); empty rows are ignored. */
async function rows(fd: FormData, withCost = false) {
  const out: { variantId: string; quantity: number; unitCostMinor: number; serials?: string }[] = [];
  for (let i = 0; i < 60; i++) {
    const code = str(fd, `code_${i}`);
    if (!code) continue;
    const quantity = int(fd, `qty_${i}`);
    if (!Number.isInteger(quantity) || quantity < 1) throw invalid(`Row ${i + 1}: enter a quantity of 1 or more.`);
    const cost = withCost ? optMoney(fd, `cost_${i}`) : null;
    if (withCost && cost === null) throw invalid(`Row ${i + 1}: enter the unit cost.`);
    fd.set("code", code);
    out.push({ variantId: await itemId(fd, "code"), quantity, unitCostMinor: cost ?? 0, serials: str(fd, `serials_${i}`) || undefined });
  }
  return out;
}

// ── Stock ──

export async function stockAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const db = getDb();
    const op = str(fd, "op");
    const variantId = await itemId(fd, str(fd, "variantId") ? "variantId" : "code");
    const locationId = str(fd, "locationId") || null;
    if (op === "receive") {
      await receiveStock(db, actor, { variantId, locationId, quantity: int(fd, "quantity"), unitCostMinor: optMoney(fd, "unitCost"), serials: str(fd, "serials"), note: str(fd, "note") });
    } else if (op === "adjust") {
      if (!locationId) throw invalid("Choose the location.");
      await adjustStock(db, actor, { variantId, locationId, reason: str(fd, "reason") as AdjustReason, quantity: int(fd, "quantity"), note: str(fd, "note"), serials: str(fd, "serials") });
    } else if (op === "count") {
      await countStock(db, actor, { variantId, locationId, counted: int(fd, "quantity"), note: str(fd, "note") });
    } else throw invalid("Unknown action.");
    revalidatePath("/admin", "layout");
    return op === "receive" ? "Stock received." : op === "count" ? "Count saved." : "Adjustment recorded.";
  });
}

export async function stockSettingsAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await updateStockSettings(getDb(), actor, str(fd, "variantId"), {
      barcode: str(fd, "barcode"),
      reorderPoint: optInt(fd, "reorderPoint"),
      reorderQty: optInt(fd, "reorderQty"),
      leadTimeDays: optInt(fd, "leadTimeDays"),
      serialTracked: bool(fd, "serialTracked"),
      preferredSupplierId: str(fd, "preferredSupplierId") || null,
    });
    revalidatePath("/admin", "layout");
    return "Stock settings saved.";
  });
}

export async function locationAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await saveLocation(getDb(), actor, str(fd, "id") || null, {
      code: str(fd, "code"),
      name: str(fd, "name"),
      kind: str(fd, "kind") as never,
      sellable: bool(fd, "sellable"),
      isDefault: bool(fd, "isDefault"),
      active: bool(fd, "active"),
      address: str(fd, "address"),
    });
    revalidatePath("/admin/inventory/locations");
    return "Location saved.";
  });
}

// ── Transfers ──

export async function createTransferAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    id = (await createTransfer(getDb(), actor, { fromLocationId: str(fd, "fromLocationId"), toLocationId: str(fd, "toLocationId"), note: str(fd, "note"), lines: await rows(fd) })).id;
  });
  if (!r.ok) return r;
  redirect(`/admin/inventory/transfers/${id}`);
}

export async function transferAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const db = getDb();
    const id = str(fd, "id");
    const op = str(fd, "op");
    if (op === "dispatch") {
      const serials: Record<string, string> = {};
      for (const [k, v] of fd.entries()) if (k.startsWith("serials_") && typeof v === "string") serials[k.slice(8)] = v;
      await dispatchTransfer(db, actor, id, serials);
    } else if (op === "receive") await receiveTransfer(db, actor, id);
    else if (op === "cancel") await cancelTransfer(db, actor, id, str(fd, "reason"));
    else throw invalid("Unknown action.");
    revalidatePath(`/admin/inventory/transfers/${id}`);
    return op === "dispatch" ? "Sent — stock has left the source location." : op === "receive" ? "Received — stock is at the destination." : "Transfer cancelled.";
  });
}

// ── Stocktakes ──

export async function startCountAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    id = (await startCount(getDb(), actor, { locationId: str(fd, "locationId"), categoryId: str(fd, "categoryId") || null, blind: bool(fd, "blind"), note: str(fd, "note") })).id;
  });
  if (!r.ok) return r;
  redirect(`/admin/inventory/counts/${id}`);
}

export async function countAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const db = getDb();
    const id = str(fd, "id");
    const op = str(fd, "op");
    if (op === "scan") {
      const qty = str(fd, "scanQty") ? int(fd, "scanQty") : 1;
      const r = await scanIntoCount(db, actor, id, str(fd, "code"), qty);
      revalidatePath(`/admin/inventory/counts/${id}`);
      return `${r.label}: ${r.counted} counted.`;
    }
    if (op === "save") {
      const entries: { variantId: string; counted: number | null }[] = [];
      for (const [k, v] of fd.entries()) {
        if (!k.startsWith("count_") || typeof v !== "string") continue;
        entries.push({ variantId: k.slice(6), counted: v.trim() === "" ? null : Number(v) });
      }
      await recordCounts(db, actor, id, entries);
      revalidatePath(`/admin/inventory/counts/${id}`);
      return "Counts saved.";
    }
    if (op === "complete") {
      const r = await completeCount(db, actor, id);
      revalidatePath(`/admin/inventory/counts/${id}`);
      return `Stocktake posted: ${r.changed} of ${r.counted} counted item(s) changed.`;
    }
    if (op === "cancel") {
      await cancelCount(db, actor, id);
      revalidatePath(`/admin/inventory/counts/${id}`);
      return "Stocktake cancelled; nothing was changed.";
    }
    throw invalid("Unknown action.");
  });
}

// ── Purchasing ──

export async function supplierAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id") || null;
  let created = "";
  const r = await run(async () => {
    const s = await saveSupplier(getDb(), actor, id, {
      name: str(fd, "name"),
      contactName: str(fd, "contactName"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      address: str(fd, "address"),
      taxId: str(fd, "taxId"),
      paymentTermsDays: int(fd, "paymentTermsDays") || 0,
      leadTimeDays: optInt(fd, "leadTimeDays"),
      active: bool(fd, "active"),
      notes: str(fd, "notes"),
    });
    created = id ? "" : s.id;
    revalidatePath("/admin/suppliers");
    return "Supplier saved.";
  });
  if (r.ok && created) redirect(`/admin/suppliers/${created}`);
  return r;
}

export async function createPoAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    const lines = await rows(fd, true);
    id = (await createPurchaseOrder(getDb(), actor, { supplierId: str(fd, "supplierId"), locationId: str(fd, "locationId") || null, expectedAt: str(fd, "expectedAt"), notes: str(fd, "notes"), lines })).id;
  });
  if (!r.ok) return r;
  redirect(`/admin/purchasing/${id}`);
}

export async function poAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const db = getDb();
    const id = str(fd, "id");
    const op = str(fd, "op");
    if (op === "send") {
      const r = await sendPurchaseOrder(db, actor, id, { email: bool(fd, "email") });
      revalidatePath(`/admin/purchasing/${id}`);
      return r.emailed ? "Marked as sent and e-mailed to the supplier." : "Marked as sent.";
    }
    if (op === "receive") {
      const lines: { lineId: string; quantity: number; serials?: string }[] = [];
      for (const [k, v] of fd.entries()) {
        if (!k.startsWith("recv_") || typeof v !== "string" || v.trim() === "") continue;
        const lineId = k.slice(5);
        lines.push({ lineId, quantity: Number(v), serials: str(fd, `serials_${lineId}`) || undefined });
      }
      const g = await receivePurchaseOrder(db, actor, id, { reference: str(fd, "reference"), notes: str(fd, "notes"), lines });
      revalidatePath(`/admin/purchasing/${id}`);
      return `Received (${g.number}). Stock and average costs are updated.`;
    }
    if (op === "cancel") {
      await cancelPurchaseOrder(db, actor, id, str(fd, "reason"));
      revalidatePath(`/admin/purchasing/${id}`);
      return "Purchase order closed.";
    }
    throw invalid("Unknown action.");
  });
}

export async function draftFromReorderAction(_: Prev) {
  const actor = await staff();
  return run(async () => {
    const r = await draftOrdersFromReorder(getDb(), actor);
    revalidatePath("/admin/purchasing");
    const made = r.created.length ? `Drafted ${r.created.map((c) => c.number).join(", ")}.` : "No purchase orders drafted.";
    const left = r.unassigned.length ? `\nNo preferred supplier for: ${r.unassigned.map((u) => u.sku).join(", ")} — set one on the product, or order by hand.` : "";
    return made + left;
  });
}
