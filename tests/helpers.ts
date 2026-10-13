import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { seed } from "@/server/db/seed";
import { productVariants, users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/service";
import type { Actor } from "@/server/authz/policy";

export const TEST_PASSWORD = "Correct-Horse-Battery-9";

export async function setupDb() {
  const { db, close } = createDb("pglite://memory");
  await runMigrations(db, "pglite://memory");
  const seeded = await seed(db, { demoPassword: TEST_PASSWORD, withDemoActivity: false });
  return { db, close, ...seeded };
}

/** Loads a staff actor as if signed in; `mfa` simulates a session that passed two-step verification. */
export async function actorFor(db: DB, email: string, mfa = true): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`No user ${email}`);
  return (await loadActor(db, u.id, { id: "test-session", mfaVerified: mfa }))!;
}

export const variant = async (db: DB, sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;

export const guest = { name: "Ama Mensah", phone: "0241234567", email: "ama@example.com", fulfilmentMethod: "pickup" as const };
