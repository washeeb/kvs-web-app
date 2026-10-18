import { expect, test } from "@playwright/test";
import { expectAccessible, watchCsp } from "./helpers";
import { STATE } from "./auth.setup";

const PUBLIC = ["/", "/services", "/services/cctv-installation", "/shop", "/shop/demo-wifi-router", "/shop/demo-outdoor-access-point", "/contact?product=demo-outdoor-access-point", "/shop/cart", "/contact", "/privacy", "/login", "/forgot-password"];

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
  for (const path of ["/admin/products", "/admin/products/new", "/admin/categories", "/admin/brands", "/admin/tags", "/admin/services", "/admin/services/cctv-installation", "/admin/slides", "/admin/ses", "/admin/inventory", "/admin/inventory/receive", "/admin/inventory/transfers", "/admin/inventory/counts", "/admin/inventory/reorder", "/admin/inventory/serials?q=CAM", "/admin/inventory/labels?code_0=KVS-MOUSE-WL&qty_0=2", "/admin/inventory/movements", "/admin/inventory/locations", "/admin/purchasing", "/admin/purchasing/new", "/admin/suppliers"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
    });
  }
});

test.describe("reports (manager)", () => {
  test.use({ storageState: STATE.manager });
  for (const path of ["/admin/reports", "/admin/reports?range=12m", "/admin/reports/products", "/admin/reports/inventory", "/admin/reports/forecast", "/admin/reports/finance", "/admin/reports/purchasing", "/admin/reports/pipeline"]) {
    test(`${path} is accessible`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
      expect(csp).toEqual([]);
    });
  }
});
