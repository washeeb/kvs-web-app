import { test as setup } from "@playwright/test";
import { signIn } from "./helpers";

// Sign in once per role and reuse the session, so the suite stays well inside the login rate limits
// (10 attempts per account per 15 minutes) that it would otherwise trip.
export const STATE = { sales: "e2e/.auth/sales.json", store: "e2e/.auth/store.json" };

setup("sign in as sales", async ({ page }) => {
  await signIn(page, "sales@kingsview.demo");
  await page.context().storageState({ path: STATE.sales });
});

setup("sign in as store", async ({ page }) => {
  await signIn(page, "store@kingsview.demo");
  await page.context().storageState({ path: STATE.store });
});
