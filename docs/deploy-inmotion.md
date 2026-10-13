# Deploying KingsView to InMotion (same Power plan as Synclytics)

> Status: **live since 2026-10-13** at https://kingsviewsolutions.com. The bundle, deploy hook and pipeline are the same ones that run Synclytics in production, adapted to a separate folder, database and repository.

KingsView runs as a **second Node.js app on the same cPanel account** as Synclytics, with its **own** domain, PostgreSQL database, settings file, repository and folder (`~/kvs-app`). Nothing is shared with Synclytics except the hosting account; the two systems talk only through the partner link (`docs/ses-link.md`).

## 1. Domain

**Done.** `kingsviewsolutions.com` is an addon domain on the account (document root `~/kingsviewsolutions.com`; Passenger serves the app, the folder just needs to exist), on InMotion nameservers with AutoSSL issued. Its existing e-mail is unaffected.

## 2. Database

cPanel → **PostgreSQL Databases**: database `n789825_kvs`, user `n789825_kvsadmin` (letters and numbers only in the password), added with **ALL PRIVILEGES**, then **Synchronize Grants**.
`DATABASE_URL=postgres://n789825_kvsadmin:<password>@127.0.0.1:5432/n789825_kvs`

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

cPanel's Create form does not accept the `github-kvs:` alias as a clone URL, so clone in Terminal and register the folder:
```bash
git clone -b deploy github-kvs:washeeb/kvs-web-app.git ~/repositories/kvs-web-app
```
cPanel → **Git Version Control → Create** with **Clone a Repository off**, path `repositories/kvs-web-app`, name `kvs-web-app`. Then **Manage → Checked-Out Branch: `deploy`** → **Pull or Deploy → Deploy HEAD Commit**. The hook copies the app to `~/kvs-app`, runs migrations, refreshes the system roles and restarts the app.

## 4. Settings file `~/kvs-app/.env.production` (permissions 600)

```
NODE_ENV=production
APP_URL=https://kingsviewsolutions.com
DATABASE_URL=postgres://...
APP_ENCRYPTION_KEY=<openssl rand -base64 32>
CRON_SECRET=<openssl rand -base64 24>
WORKER_MODE=inline
DB_POOL_MAX=3
MAIL_ADAPTER=smtp
SMTP_HOST=<mail server>
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@kingsviewsolutions.com
SMTP_PASSWORD=<mailbox password>
MAIL_FROM="KingsView Solutions <no-reply@kingsviewsolutions.com>"
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

If the bare domain still shows the old "Index of /" page, InMotion's nginx cache is holding it: cPanel → **NGINX Manager → Clear Cache**. The app sends `no-store`, so this is needed once.

## 6. First administrator and cron

```bash
cd ~/kvs-app && set -a && . ./.env.production && set +a && ~/nodevenv/kvs-app/24/bin/node ops/create-admin.mjs info@kingsviewsolutions.com "Owner Name"; cd ~
```
This account gets the **Owner / Administrator** role and must set up two-step verification at first sign-in.

cPanel → **Cron Jobs** → *Once Per Five Minutes*:
```
curl -fsS -m 50 -A "Mozilla/5.0 (cron)" -H "Authorization: Bearer $(grep ^CRON_SECRET= $HOME/kvs-app/.env.production | cut -d= -f2)" https://kingsviewsolutions.com/api/cron/tick >/dev/null 2>&1
```
InMotion's firewall (ModSecurity) answers **406** to requests that identify as `curl`, and to a `POST` with no body, so the line sends a browser user agent and a plain GET. The secret is read from the settings file, so it never appears in the cron list. Add the job in the cPanel screen (piping into `crontab -` from Terminal replaced an existing line once). Test by hand: the same command without `>/dev/null 2>&1`, plus `-o /dev/null -w "%{http_code}\n"` — expect `200`.

## 7. After go-live

- Settings → company details, TIN, **payment instructions** (MoMo / bank), opening hours; confirm KingsView's **VAT status** and switch the taxes off if it is not VAT-registered.
- Add real products (Products & stock) and remove nothing from the demo — production never contains demo data.
- Pictures are stored in `~/kvs-data/uploads` (next to the app, so deploys never delete them). Set `UPLOAD_DIR` only to move them.
- Starter pictures (once, after the deploy that adds slides): installs the home page slides and the illustrations for service pages and shop categories. It only fills gaps (anything that already has a picture is skipped, and slides are only added when there are none), so it is safe to run again. The e-mail is the staff member recorded as uploading them.
  ```bash
  cd ~/kvs-app && set -a && . ./.env.production && set +a && ~/nodevenv/kvs-app/24/bin/node ops/starter-images.mjs info@kingsviewsolutions.com; cd ~
  ```
  Then edit the slide wording under **Catalogue → Home page slides**, and replace any illustration with a real photo from the same page when one is available.
- Backups: InMotion Backup Manager already covers the home directory (incl. `~/kvs-app/.env.production` and `~/kvs-data`) and all PostgreSQL databases.
- Paystack webhook (when keys exist): `https://kingsviewsolutions.com/api/webhooks/paystack`.
