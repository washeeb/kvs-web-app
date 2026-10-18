// Loads a supplier product import prepared by scripts/supplier-import/prepare.mjs.
// Usage: npm run products:import -- <import folder> <staff e-mail> [--limit=N]
// On the server: node ops/import-products.mjs <import folder> <staff e-mail>
// The staff member is recorded as the creator; they need catalogue.write and purchasing.write.
import { DATABASE_URL } from "./env";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { loadActor } from "../src/server/auth/service";
import { can } from "../src/server/authz/policy";
import { importProducts } from "../src/server/modules/product-import";

const [dir, emailArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1]) || undefined;
if (!dir || !emailArg || !existsSync(path.join(dir, "products.json"))) {
  console.error("Usage: npm run products:import -- <import folder containing products.json> <staff e-mail> [--limit=N]");
  process.exit(1);
}
const { db, close } = createDb(DATABASE_URL);
const [user] = await db.select().from(users).where(eq(users.email, emailArg.toLowerCase()));
// Shell access to the server stands in for the sign-in and two-step check here.
const actor = user && (await loadActor(db, user.id, { id: "cli", mfaVerified: true }));
if (!actor || !can(actor, "catalogue.write") || !can(actor, "purchasing.write")) {
  console.error(`${emailArg} is not a staff member who can edit the catalogue and suppliers.`);
  await close();
  process.exit(1);
}
const started = Date.now();
const r = await importProducts(db, actor, dir, { limit });
await close();
for (const c of r.categoriesCreated) console.log(`category  ${c}`);
for (const s of r.suppliersCreated) console.log(`supplier  ${s}`);
if (r.brandsCreated.length) console.log(`brands    ${r.brandsCreated.join(", ")}`);
for (const p of r.problems) console.log(`problem   ${p}`);
console.log(`${r.productsCreated} product(s) created, ${r.productsSkipped} already there, ${r.pictures} picture(s) added in ${Math.round((Date.now() - started) / 1000)} s.`);
