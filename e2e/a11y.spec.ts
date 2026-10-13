import { expect, test } from "@playwright/test";
import { expectAccessible, watchCsp } from "./helpers";
import { STATE } from "./auth.setup";

const PUBLIC = ["/", "/services", "/services/cctv-installation", "/shop", "/shop/demo-wifi-router", "/shop/cart", "/contact", "/privacy", "/login", "/forgot-password"];

test.describe("public pages", () => {
  for (const path of PUBLIC) {
    test(`${path} is accessible with no CSP errors`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expectAccessible(page, path);
      expect(csp).toEqual([]);
    });
  }
});

test.describe("staff pages (sales)", () => {
  test.use({ storageState: STATE.sales });
  for (const path of ["/admin", "/admin/enquiries", "/admin/customers", "/admin/customers/new", "/admin/quotes", "/admin/quotes/new", "/admin/orders", "/admin/jobs", "/admin/jobs/new", "/admin/notifications"]) {
    test(`${path} is accessible`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
      expect(csp).toEqual([]);
    });
  }
});

test.describe("staff pages (store)", () => {
  test.use({ storageState: STATE.store });
  for (const path of ["/admin/products", "/admin/products/new", "/admin/ses"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
    });
  }
});
