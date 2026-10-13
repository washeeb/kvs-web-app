"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { bool, int, percentToBp, run, str, type ActionState } from "@/server/web/actions";
import { appUrl, requireActor } from "@/server/web/session";
import { parseMoney } from "@/server/lib/money";
import { invalid } from "@/server/lib/errors";
import { assignRole, createUser, revokeAssignment, setUserStatus } from "@/server/modules/admin";
import { decideApproval } from "@/server/modules/approvals";
import { updateSettings, upsertTax } from "@/server/modules/settings";
import { enquiryCustomer, updateEnquiry } from "@/server/modules/enquiries";
import { createCustomer, updateCustomer } from "@/server/modules/customers";
import { acceptQuote, createQuote, declineQuote, sendQuote } from "@/server/modules/quotes";
import { cancelOrder, confirmOrder, fulfilOrder, markReady } from "@/server/modules/orders";
import { createJob, scheduleJob, setJobStatus } from "@/server/modules/service-jobs";
import { addVariant, createProduct, updateProduct, updateVariant } from "@/server/modules/catalogue";
import { changeStock } from "@/server/modules/inventory";
import { issueInvoice, recordManualPayment, reverseManualPayment, voidInvoice } from "@/server/modules/invoices";
import { resyncAll, retryDead } from "@/server/modules/ses-link";

type Prev = ActionState;
const staff = () => requireActor("operator");
const money = (fd: FormData, k: string) => {
  const v = parseMoney(str(fd, k));
  if (v === null) throw invalid("Enter an amount such as 1250.00");
  return v;
};
const optionalMoney = (fd: FormData, k: string) => (str(fd, k) ? money(fd, k) : null);

// ── Administration ──

export async function updateSettingsAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await updateSettings(getDb(), actor, {
      companyName: str(fd, "companyName"),
      companyAddress: str(fd, "companyAddress"),
      companyTin: str(fd, "companyTin"),
      contactEmail: str(fd, "contactEmail"),
      contactPhone: str(fd, "contactPhone"),
      whatsappNumber: str(fd, "whatsappNumber"),
      openingHours: str(fd, "openingHours"),
      instagramUrl: str(fd, "instagramUrl"),
      facebookUrl: str(fd, "facebookUrl"),
      paymentInstructions: str(fd, "paymentInstructions"),
      deliveryNote: str(fd, "deliveryNote"),
      shopOrderLimitMinor: money(fd, "shopOrderLimit"),
      quoteValidityDays: int(fd, "quoteValidityDays"),
      reservationHoldHours: int(fd, "reservationHoldHours"),
      invoiceDueDays: int(fd, "invoiceDueDays"),
      dpcRegistrationNumber: str(fd, "dpcRegistrationNumber"),
      dpcRegistrationExpires: str(fd, "dpcRegistrationExpires"),
    });
    revalidatePath("/admin/settings");
    return "Settings saved.";
  });
}

export async function upsertTaxAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await upsertTax(getDb(), actor, str(fd, "id") || null, { code: str(fd, "code"), name: str(fd, "name"), rateBp: percentToBp(str(fd, "ratePercent")), compound: bool(fd, "compound"), active: bool(fd, "active"), sortOrder: int(fd, "sortOrder") || 0 });
    revalidatePath("/admin/settings");
    return "Tax saved.";
  });
}

export async function createUserAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await createUser(getDb(), actor, { organizationId: str(fd, "organizationId"), email: str(fd, "email"), name: str(fd, "name") }, appUrl());
    revalidatePath("/admin/users");
    return "Account created. A set-password link has been e-mailed. Give them a role below.";
  });
}

export async function userStatusAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await setUserStatus(getDb(), actor, str(fd, "id"), str(fd, "status") === "active" ? "active" : "disabled");
    revalidatePath("/admin/users");
    return "Account updated.";
  });
}

export async function assignRoleAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const r = await assignRole(getDb(), actor, { userId: str(fd, "userId"), permissionSetId: str(fd, "permissionSetId"), departmentId: null });
    revalidatePath("/admin/users");
    return r.applied ? "Role given." : "This role has sensitive access, so another administrator must approve it (Approvals).";
  });
}

export async function revokeAssignmentAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    await revokeAssignment(getDb(), actor, str(fd, "id"));
    revalidatePath("/admin/users");
    return "Role removed and the user's sessions were signed out.";
  });
}

export async function decideApprovalAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    const approve = str(fd, "decision") === "approve";
    await decideApproval(getDb(), actor, str(fd, "id"), approve, str(fd, "note"));
    revalidatePath("/admin/approvals");
    return approve ? "Approved." : "Rejected.";
  });
}

// ── Enquiries & customers ──

export async function enquiryAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  if (str(fd, "op") === "quote") {
    let customerId = "";
    const r = await run(async () => {
      customerId = await enquiryCustomer(getDb(), actor, id);
    });
    if (!r.ok) return r;
    redirect(`/admin/quotes/new?customer=${customerId}&enquiry=${id}`);
  }
  return run(async () => {
    if (str(fd, "op") === "customer") {
      await enquiryCustomer(getDb(), actor, id);
    } else {
      await updateEnquiry(getDb(), actor, id, { status: str(fd, "status") || undefined, assigneeUserId: fd.has("assigneeUserId") ? str(fd, "assigneeUserId") || null : undefined });
    }
    revalidatePath(`/admin/enquiries/${id}`);
    return "Enquiry updated.";
  });
}

const customerFields = (fd: FormData) => ({ name: str(fd, "name"), company: str(fd, "company"), phone: str(fd, "phone"), email: str(fd, "email"), address: str(fd, "address"), notes: str(fd, "notes") });

export async function saveCustomerAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  let target = "";
  const r = await run(async () => {
    if (id) await updateCustomer(getDb(), actor, id, customerFields(fd));
    else target = `/admin/customers/${(await createCustomer(getDb(), actor, customerFields(fd))).id}`;
  });
  if (!r.ok || !target) return r.ok ? { ...r, message: "Customer saved." } : r;
  redirect(target);
}

// ── Quotations ──

export async function createQuoteAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    const lines = JSON.parse(str(fd, "lines") || "[]") as unknown[];
    const q = await createQuote(getDb(), actor, { customerId: str(fd, "customerId"), enquiryId: str(fd, "enquiryId") || null, serviceLine: str(fd, "serviceLine"), discountBp: percentToBp(str(fd, "discountPercent")), notes: str(fd, "notes"), lines: lines as never });
    id = q.id;
  });
  if (!r.ok) return r;
  redirect(`/admin/quotes/${id}`);
}

export async function quoteAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  const op = str(fd, "op");
  if (op === "accept") {
    let orderId = "";
    const r = await run(async () => {
      orderId = (await acceptQuote(getDb(), actor, id, { createJob: bool(fd, "createJob"), jobTitle: str(fd, "jobTitle"), serviceLine: str(fd, "serviceLine") })).orderId;
    });
    if (!r.ok) return r;
    redirect(`/admin/orders/${orderId}`);
  }
  return run(async () => {
    if (op === "send") await sendQuote(getDb(), actor, id);
    else await declineQuote(getDb(), actor, id);
    revalidatePath(`/admin/quotes/${id}`);
    return op === "send" ? "Quotation marked as sent (e-mailed if the customer has an address)." : "Quotation declined.";
  });
}

// ── Orders ──

export async function orderAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  return run(async () => {
    const db = getDb();
    switch (str(fd, "op")) {
      case "confirm":
        await confirmOrder(db, actor, id);
        break;
      case "ready":
        await markReady(db, actor, id, str(fd, "trackingReference"));
        break;
      case "fulfil":
        await fulfilOrder(db, actor, id);
        break;
      case "cancel":
        await cancelOrder(db, actor, id, str(fd, "reason"));
        break;
      case "invoice":
        await issueInvoice(db, actor, id);
        break;
    }
    revalidatePath(`/admin/orders/${id}`);
    return "Order updated.";
  });
}

// ── Jobs ──

export async function createJobAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    id = (await createJob(getDb(), actor, { customerId: str(fd, "customerId"), serviceLine: str(fd, "serviceLine") as never, title: str(fd, "title"), description: str(fd, "description"), location: str(fd, "location"), scheduledAt: str(fd, "scheduledAt"), assigneeUserId: str(fd, "assigneeUserId") })).id;
  });
  if (!r.ok) return r;
  redirect(`/admin/jobs/${id}`);
}

export async function jobAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  return run(async () => {
    if (str(fd, "op") === "schedule") await scheduleJob(getDb(), actor, id, { scheduledAt: str(fd, "scheduledAt"), location: str(fd, "location"), assigneeUserId: str(fd, "assigneeUserId") });
    else await setJobStatus(getDb(), actor, id, str(fd, "status"), str(fd, "note"));
    revalidatePath(`/admin/jobs/${id}`);
    return "Job updated.";
  });
}

// ── Products & stock ──

const productFields = (fd: FormData) => ({ name: str(fd, "name"), summary: str(fd, "summary"), description: str(fd, "description"), categoryId: str(fd, "categoryId") || null, status: (str(fd, "status") || "draft") as never, sesSync: bool(fd, "sesSync") });
const variantFields = (fd: FormData) => ({ sku: str(fd, "sku"), name: str(fd, "variantName") || "Standard", priceMinor: money(fd, "price"), costMinor: optionalMoney(fd, "cost"), taxable: bool(fd, "taxable"), tracksStock: bool(fd, "tracksStock") });

export async function createProductAction(_: Prev, fd: FormData) {
  const actor = await staff();
  let id = "";
  const r = await run(async () => {
    id = (await createProduct(getDb(), actor, productFields(fd), variantFields(fd))).product.id;
  });
  if (!r.ok) return r;
  redirect(`/admin/products/${id}`);
}

export async function productAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "productId");
  return run(async () => {
    const db = getDb();
    switch (str(fd, "op")) {
      case "product":
        await updateProduct(db, actor, id, productFields(fd));
        break;
      case "add_variant":
        await addVariant(db, actor, id, variantFields(fd));
        break;
      case "variant":
        await updateVariant(db, actor, str(fd, "variantId"), { name: str(fd, "variantName"), priceMinor: money(fd, "price"), costMinor: optionalMoney(fd, "cost"), taxable: bool(fd, "taxable"), active: bool(fd, "active") });
        break;
      case "stock":
        await changeStock(db, actor, { variantId: str(fd, "variantId"), mode: str(fd, "mode") === "count" ? "count" : "receive", quantity: int(fd, "quantity"), note: str(fd, "note") });
        break;
    }
    revalidatePath(`/admin/products/${id}`);
    return "Saved.";
  });
}

// ── Finance ──

export async function paymentAction(_: Prev, fd: FormData) {
  const actor = await staff();
  const id = str(fd, "id");
  return run(async () => {
    const db = getDb();
    switch (str(fd, "op")) {
      case "record":
        await recordManualPayment(db, actor, id, { amountMinor: money(fd, "amount"), method: str(fd, "method") as never, externalReference: str(fd, "externalReference"), paidOn: str(fd, "paidOn"), note: str(fd, "note") });
        break;
      case "reverse":
        await reverseManualPayment(db, actor, str(fd, "paymentId"), str(fd, "reason"));
        break;
      case "void":
        await voidInvoice(db, actor, id, str(fd, "reason"));
        break;
    }
    revalidatePath(`/admin/invoices/${id}`);
    return "Saved.";
  });
}

// ── Synclytics link ──

export async function sesAction(_: Prev, fd: FormData) {
  const actor = await staff();
  return run(async () => {
    if (str(fd, "op") === "retry") {
      await retryDead(getDb(), actor, str(fd, "id"));
      revalidatePath("/admin/ses");
      return "Queued again.";
    }
    const n = await resyncAll(getDb(), actor);
    revalidatePath("/admin/ses");
    return `Queued ${n} product option(s) for Synclytics.`;
  });
}
