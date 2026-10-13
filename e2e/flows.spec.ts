import { expect, test } from "@playwright/test";
import { expectAccessible, makePng } from "./helpers";
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
    await page.goto("/admin/orders");
    const nav = page.getByRole("navigation", { name: "Back office" });
    const menu = nav.getByRole("button", { name: /^Menu/ });
    if (await menu.isVisible()) await menu.click();
    await expect(nav.getByRole("link", { name: "Orders", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
    await expect(nav.locator("summary", { hasText: "Sales" })).toBeVisible();
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
    // A picture is resized and converted in the browser, checked and stored by the server, then served.
    await page.getByLabel("Pictures").setInputFiles({ name: "switch.png", mimeType: "image/png", buffer: makePng(1200, 800) });
    await page.getByLabel("Describe the picture").fill("Front of the switch");
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 image added." })).toBeVisible();
    const img = page.locator('img[src^="/media/"]').first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("srcset", /320w.*800w.*1200w/);
    const res = await page.request.get((await img.getAttribute("src"))!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/webp");
    expect(res.headers()["cache-control"]).toContain("immutable");
    await expectAccessible(page, "product page");
  });
  test("add a home page slide with a picture, see it in the slider, then delete it", async ({ page }) => {
    const headline = `E2E slide ${Date.now()}`;
    await page.goto("/admin/slides");
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Button label").fill("See the shop");
    await page.getByLabel("Button link").fill("//evil.example");
    await page.getByRole("button", { name: "Create slide" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Use a page on this site" })).toBeVisible();
    // The form starts again after a refused save.
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Button label").fill("See the shop");
    await page.getByLabel("Button link").fill("/shop");
    await page.getByRole("button", { name: "Create slide" }).click();
    await page.waitForURL(/\/admin\/slides\/[0-9a-f-]{36}$/);
    await page.getByLabel("Pictures").setInputFiles({ name: "slide.png", mimeType: "image/png", buffer: makePng(1600, 1067) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.locator('img[src^="/media/"]').first()).toBeVisible();
    const slideUrl = page.url();

    await page.goto("/");
    const slider = page.getByRole("region", { name: "Highlights" });
    const next = slider.getByRole("button", { name: "Next slide" });
    if (await next.isVisible()) {
      // Other slides exist: stop the rotation, pick ours, then move on from it.
      await slider.getByRole("button", { name: "Stop the slides" }).click();
      await expect(slider.getByRole("button", { name: "Start the slides" })).toBeVisible();
      await slider.getByRole("button", { name: `: ${headline}` }).click();
      await expect(slider.getByRole("heading", { name: headline })).toBeVisible();
      await next.click();
      await expect(slider.getByRole("heading", { name: headline })).toBeHidden();
    } else {
      await expect(slider.getByRole("heading", { name: headline })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessible(page, "home page slider");

    await page.goto(slideUrl);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete slide" }).click();
    await page.waitForURL(/\/admin\/slides$/);
    await expect(page.getByRole("link", { name: headline })).toHaveCount(0);
  });
});

test.describe("stock and purchasing", () => {
  test.use({ storageState: STATE.store });
  test("raise a purchase order, send it and receive the delivery", async ({ page }) => {
    await page.goto("/admin/suppliers");
    const name = `E2E Supplier ${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Lead time (days)").fill("4");
    await page.getByRole("button", { name: "Add supplier" }).click();
    await page.waitForURL(/\/admin\/suppliers\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "New purchase order" }).click();
    await page.getByLabel("Item 1", { exact: true }).fill("KVS-A4-REAM");
    await page.getByLabel("Quantity 1", { exact: true }).fill("10");
    await page.getByLabel("Unit cost 1", { exact: true }).fill("55.00");
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.waitForURL(/\/admin\/purchasing\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/PO-\d{4}-\d{5}/);
    await page.getByRole("button", { name: "Mark as sent" }).click();
    // The send panel gives way to the receive panel once the order is sent.
    await expect(page.getByRole("heading", { name: "Receive a delivery" })).toBeVisible();
    await page.getByLabel(/to come/).fill("10");
    await page.getByLabel("Delivery note / invoice no.").fill("DN-E2E");
    await page.getByRole("button", { name: "Receive into stock" }).click();
    await expect(page.getByRole("heading", { name: "Deliveries received" })).toBeVisible();
    await expect(page.getByText(/GRN-\d{4}-\d{5}/).first()).toBeVisible();
    await expect(page.getByText("received", { exact: true }).first()).toBeVisible();
    await expectAccessible(page, "purchase order");
  });

  test("count stock by scanning and post the difference", async ({ page }) => {
    await page.goto("/admin/inventory/counts");
    await page.getByRole("button", { name: "Start" }).click();
    // Only one open stocktake per location: continue the open one if a previous attempt left it.
    const started = await Promise.race([
      page.waitForURL(/\/admin\/inventory\/counts\/[0-9a-f-]{36}$/).then(() => true),
      page.getByRole("alert").filter({ hasText: /still open/ }).waitFor().then(() => false),
    ]);
    if (!started) {
      await page.getByRole("row").filter({ hasText: "open" }).getByRole("link").first().click();
      await page.waitForURL(/\/admin\/inventory\/counts\/[0-9a-f-]{36}$/);
    }
    const scan = page.getByLabel(/Scan each unit/);
    await scan.fill("KVS-MUG-WHT"); // not stock-tracked
    await scan.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: /does not track stock/ })).toBeVisible();
    await scan.fill("KVS-CAT6-3M");
    await page.getByLabel("Quantity", { exact: true }).fill("3");
    await scan.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /3 counted/ })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Finish and post differences" }).click();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Difference posted (at cost)")).toBeVisible();
  });

  test("print barcode labels", async ({ page }) => {
    await page.goto("/admin/inventory/labels?code_0=KVS-MOUSE-WL&qty_0=3");
    await expect(page.getByRole("img", { name: "Barcode KVS-MOUSE-WL" })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Print 3 labels" })).toBeVisible();
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

test.describe("manager reports", () => {
  test.use({ storageState: STATE.manager });
  test("switches period, highlights the tab and downloads CSV", async ({ page }) => {
    await page.goto("/admin/reports/products");
    await expect(page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Products" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("combobox", { name: "Period" }).selectOption("12m");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/range=12m/);
    await expect(page.getByText("Last 12 months.", { exact: false }).first()).toBeVisible();
    const csv = await page.request.get("/api/reports/products?range=12m");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("sku,item,category,brand,abc");
    const denied = await page.request.get("/api/reports/nope");
    expect(denied.status()).toBe(404);
  });
});
