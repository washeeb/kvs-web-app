# Deploying KingsView to InMotion (same Power plan as Synclytics)

> Status: **not deployed yet.** Waiting for the KingsView domain name. The bundle, deploy hook and pipeline are the same ones that run Synclytics in production, adapted to a separate folder, database and repository.

KingsView runs as a **second Node.js app on the same cPanel account** as Synclytics, with its **own** domain, PostgreSQL database, settings file, repository and folder (`~/kvs-app`). Nothing is shared with Synclytics except the hosting account; the two systems talk only through the partner link (`docs/ses-link.md`).

## 1. Domain

cPanel → **Domains → Create a new domain**: add the KingsView domain (for example `kingsviewsolutions.com`) with its own document root, e.g. `kvs.public_html` (Passenger serves the app; the folder just needs to exist). Point the domain's DNS at InMotion if it is registered elsewhere, then run **SSL/TLS Status → Run AutoSSL**.

## 2. Database

cPanel → **PostgreSQL Databases**: create database `kvs`, user `kvsapp` (letters and numbers only in the password), add the user with **ALL PRIVILEGES**, then **Synchronize Grants**.
`DATABASE_URL=postgres://<cpuser>_kvsapp:<password>@127.0.0.1:5432/<cpuser>_kvs`

## 3. Repository and cPanel Git

The source is the private GitHub repository **washeeb/kvs-web-app**. GitHub Actions tests every push to `main` (unit, contract, browser and accessibility tests) and publishes a ready-to-run bundle to the `deploy` branch.

GitHub does not allow one deploy key on two repositories, so KingsView needs **its own key** (the Synclytics key stays as it is). In cPanel → **Terminal**:

```bash
ssh-keygen -t ed25519 -N "" -C "inmotion-kvs-deploy" -f ~/.ssh/id_ed25519_kvs
```
```bash
printf 'Host github-kvs\n  HostName github.com\n  User git\n  IdentityFile ~/.ssh/id_ed25519_kvs\n  IdentitiesOnly yes\n' >> ~/.ssh/config && chmod 600 ~/.ssh/config
```
```bash
cat ~/.ssh/id_ed25519_kvs.pub
```
GitHub → **washeeb/kvs-web-app → Settings → Deploy keys → Add deploy key**: paste it, title `InMotion cPanel`, **no** write access. Then `ssh -T github-kvs` (answer `yes`).

cPanel → **Git Version Control → Create**: Clone URL `github-kvs:washeeb/kvs-web-app.git`, path `repositories/kvs-web-app`. Then **Manage → Checked-Out Branch: `deploy`** → **Pull or Deploy → Deploy HEAD Commit**. The hook copies the app to `~/kvs-app`, runs migrations, refreshes the system roles and restarts the app.

## 4. Settings file `~/kvs-app/.env.production` (permissions 600)

```
NODE_ENV=production
APP_URL=https://<kingsview-domain>
DATABASE_URL=postgres://...
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -base64 24>
WORKER_MODE=inline
DB_POOL_MAX=3
MAIL_ADAPTER=smtp
SMTP_HOST=<mail server>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@<kingsview-domain>
SMTP_PASSWORD=<mailbox password>
MAIL_FROM="KingsView Solutions <no-reply@<kingsview-domain>>"
PAYSTACK_SECRET_KEY=            # KingsView's own sk_test_… first, sk_live_… at go-live
SES_BASE_URL=                   # leave the four SES_* empty until Synclytics creates the connection
SES_CONNECTION_ID=
SES_SIGNING_SECRET=
SES_VERIFY_SECRET=
SES_MODE=production
```

Never reuse Synclytics's `APP_ENCRYPTION_KEY`, `CRON_SECRET` or database.

## 5. Node.js app

cPanel → **Setup Node.js App → Create**: Node 24, mode Production, application root `kvs-app`, URL the KingsView domain, startup file `passenger.cjs`. Start it, then **Deploy HEAD Commit** again so migrations run.

## 6. First administrator and cron

```bash
cd ~/kvs-app && source ~/nodevenv/kvs-app/24/bin/activate && node ops/create-admin.mjs owner@<kingsview-domain> "Owner Name"
```
This account gets the **Owner / Administrator** role and must set up two-step verification at first sign-in.

cPanel → **Cron Jobs** (every 5 minutes):
```
*/5 * * * * curl -fsS -m 50 -H "Authorization: Bearer <CRON_SECRET>" https://<kingsview-domain>/api/cron/tick >/dev/null 2>&1
```

## 7. After go-live

- Settings → company details, TIN, **payment instructions** (MoMo / bank), opening hours; confirm KingsView's **VAT status** and switch the taxes off if it is not VAT-registered.
- Add real products (Products & stock) and remove nothing from the demo — production never contains demo data.
- Backups: InMotion Backup Manager already covers the home directory (incl. `~/kvs-app/.env.production`) and all PostgreSQL databases.
- Paystack webhook (when keys exist): `https://<kingsview-domain>/api/webhooks/paystack`.
