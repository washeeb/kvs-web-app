"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products, productVariants } from "@/server/db/schema";
import { invalid } from "@/server/lib/errors";
import { submitEnquiry } from "@/server/modules/enquiries";
import { placeShopOrder, setCartLine } from "@/server/modules/shop";
import { startOrderPayment } from "@/server/modules/payments/paystack";
import { int, run, str, type ActionState } from "@/server/web/actions";
import { readCart, writeCart } from "@/server/web/cart";
import { appUrl, clientIp } from "@/server/web/session";

export async function enquiryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await submitEnquiry(
      getDb(),
      { serviceLine: str(fd, "serviceLine"), name: str(fd, "name"), company: str(fd, "company"), phone: str(fd, "phone"), email: str(fd, "email"), message: str(fd, "message"), website: str(fd, "website") },
      await clientIp(),
    );
    return `Thank you — your request ${r.number} has been received. We will call or e-mail you within one working day.`;
  });
}

export async function addToCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const variantId = str(fd, "variantId");
    const [ok] = await getDb()
      .select({ id: productVariants.id, price: productVariants.priceMinor })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.id, variantId), eq(productVariants.active, true), eq(products.status, "active")));
    if (!ok) throw invalid("That item is not available.");
    if (ok.price === null) throw invalid("This item is priced on request. Ask us for a quotation instead.");
    await writeCart(setCartLine(await readCart(), variantId, int(fd, "quantity"), "add"));
    revalidatePath("/", "layout");
    return "Added to your cart.";
  });
}

export async function updateCartAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const quantity = str(fd, "op") === "remove" ? 0 : int(fd, "quantity");
    await writeCart(setCartLine(await readCart(), str(fd, "variantId"), quantity, "set"));
    revalidatePath("/", "layout");
    return quantity === 0 ? "Removed." : "Updated.";
  });
}

export async function checkoutAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let token = "";
  const r = await run(async () => {
    const res = await placeShopOrder(
      getDb(),
      {
        name: str(fd, "name"),
        phone: str(fd, "phone"),
        email: str(fd, "email"),
        company: str(fd, "company"),
        fulfilmentMethod: str(fd, "fulfilmentMethod") as never,
        deliveryAddress: str(fd, "deliveryAddress"),
        notes: str(fd, "notes"),
        website: str(fd, "website"),
      },
      await readCart(),
      await clientIp(),
    );
    await writeCart([]);
    token = res.token;
  });
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  redirect(`/order/${token}?placed=1`);
}

export async function payOnlineAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let url = "";
  const r = await run(async () => {
    url = await startOrderPayment(getDb(), str(fd, "token"), str(fd, "email"), appUrl(), await clientIp());
  });
  if (!r.ok) return r;
  redirect(url);
}
