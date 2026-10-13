import { expect, test } from "@playwright/test";
import { expectAccessible } from "./helpers";
import { STATE } from "./auth.setup";

test("visitor sends a service request and gets a reference", async ({ page }) => {
  await page.goto("/services/photography-videography");
  await page.getByLabel("Your name").fill("E2E Visitor");
  await page.getByLabel("Phone or WhatsApp").fill("0240000001");
  await page.getByLabel("What do you need?").fill("Photography for a product launch next month.");
  await page.getByRole("button", { name: "Book a shoot" }).click();
  await expect(page.getByRole("status")).toContainText(/request E-\d{4}-\d{5} has been received/);
});

test("shopper orders as a guest and lands on the private order page", async ({ page }) => {
  await page.goto("/shop/demo-wireless-mouse");
  await page.getByRole("button", { name: /Add to cart/ }).first().click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
  await page.goto("/shop/cart");
  await page.getByLabel("Your name").fill("E2E Shopper");
  await page.getByLabel("Phone or WhatsApp").fill("0240000002");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/order\/[A-Za-z0-9_-]+\?placed=1/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Order O-\d{4}-\d{5}/);
  await expect(page.getByText(/Invoice INV-\d{4}-\d{5}/).first()).toBeVisible();
  await expectAccessible(page, "order page");
  // A wrong link reveals nothing.
  const res = await page.goto("/order/not-a-real-token-not-a-real-token");
  expect(res?.status()).toBe(404);
});

test.describe("store staff", () => {
  test.use({ storageState: STATE.store });
  test("see only their modules and cannot open finance", async ({ page }) => {
    await page.goto("/admin");
    const nav = page.getByRole("navigation", { name: "Back office" });
    await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Invoices & payments" })).toHaveCount(0);
    await page.goto("/admin/invoices");
    await expect(page.getByText("You can't open this page")).toBeVisible();
  });
  test("create a product and get an automatic SKU", async ({ page }) => {
    await page.goto("/admin/products/new");
    await expect(page.getByLabel(/SKU/)).toHaveCount(0);
    await page.getByLabel("Product name").fill(`E2E network switch ${Date.now()}`);
    await page.getByLabel("Category").selectOption({ label: "Networking & IT supplies" });
    await page.getByLabel(/Selling price/).fill("300.00");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/KV-NET-\d{5}/).first()).toBeVisible();
    await expectAccessible(page, "product page");
  });
});

test("anonymous visitors are sent to sign in", async ({ page }) => {
  for (const path of ["/admin", "/admin/orders", "/admin/invoices", "/admin/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
  }
});

test("security headers are served", async ({ request }) => {
  const h = (await request.get("/")).headers();
  expect(h["content-security-policy"]).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect((await request.get("/.well-known/security.txt")).status()).toBe(200);
});
