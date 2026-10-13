// One-time local setup: creates .env.local with fresh secrets (never overwrites), migrates and seeds.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

const file = ".env.local";
if (!existsSync(file)) {
  const template = readFileSync(".env.example", "utf8");
  const filled = template
    .replace(/^APP_ENCRYPTION_KEY=.*$/m, `APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`)
    .replace(/^SEED_DEMO_PASSWORD=.*$/m, `SEED_DEMO_PASSWORD=Demo-${randomBytes(9).toString("base64url")}`)
    .replace(/^CRON_SECRET=.*$/m, `CRON_SECRET=${randomBytes(24).toString("base64url")}`);
  writeFileSync(file, filled, { mode: 0o600 });
  console.log("Created .env.local with generated secrets.");
} else {
  console.log(".env.local already exists — leaving it unchanged.");
}

const run = (cmd) => execSync(cmd, { stdio: "inherit" });
run("npm run db:migrate");
run("npm run db:seed");
console.log("\nSetup complete. Start the app with: npm run dev");
