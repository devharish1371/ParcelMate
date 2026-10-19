# ParcelMate deployment

## Current hosted setup

The frontend is built by [.github/workflows/pages.yml](.github/workflows/pages.yml) and served by GitHub Pages at `https://devharish1371.github.io/ParcelMate/`. It sends Firebase ID tokens to `https://parcelmate-api.parcelmate.workers.dev`. The Worker validates each token's signature, project, and verified email before reading or changing D1 data. It normally requires the exact `@vitstudent.ac.in` suffix; a temporary operator-managed allowlist can permit specific verified test accounts. Google sign-in verifies VIT Google Workspace accounts without an email message; email/password signup uses Firebase's verification email service. Neither needs a sender domain or Resend key.

The D1 schema is [worker/schema.sql](worker/schema.sql). Apply it with `npm run db:remote`; it is written with `IF NOT EXISTS` for initial setup. Deploy the Worker with `npm run deploy:worker`. `wrangler.jsonc` holds the public D1 database ID and Firebase project ID. Wrangler OAuth credentials are stored outside this repository. The deployed API health endpoint is `/api/health`.

Before inviting students, enable the Google provider in Firebase Authentication, then complete a real `@vitstudent.ac.in` Google sign-in and profile. Also confirm a second student's friend/circle/request/credit flow and establish a D1 export and restore process. Email/password signup remains available, though delivery to the college inbox must be checked separately. A support operator needs Cloudflare D1 access to review and update technical tickets; there is no public admin route.

### Temporary external test account

Set `TEST_EMAIL_ALLOWLIST` as a Cloudflare Worker secret with the exact email addresses allowed for testing, separated by commas. Do not put those addresses in `wrangler.jsonc` or the frontend bundle. The Worker still requires a valid Firebase token with `email_verified: true`, and all other non-VIT addresses remain blocked. The app does not display testing status.

```bash
npx wrangler secret put TEST_EMAIL_ALLOWLIST
```

When testing ends, restore VIT-only access immediately with `npx wrangler secret delete TEST_EMAIL_ALLOWLIST`. This takes effect without a frontend deployment. Existing test profiles remain stored but cannot access the API after the secret is removed.

### Hosted support and backup

Run these commands from a trusted operator machine with Wrangler logged into the ParcelMate Cloudflare account. Ticket descriptions may contain personal information; keep exports and query output private.

```bash
npx wrangler d1 execute parcelmate --remote --command "SELECT id, category, status, description, created_at FROM support_tickets ORDER BY created_at DESC LIMIT 30"
npx wrangler d1 execute parcelmate --remote --command "UPDATE support_tickets SET status = 'in_review', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'TICKET_ID' AND status = 'received'"
npx wrangler d1 execute parcelmate --remote --command "UPDATE support_tickets SET status = 'resolved', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'TICKET_ID' AND status IN ('received', 'in_review')"
npx wrangler d1 export parcelmate --remote --output /secure/private/location/parcelmate-backup.sql
```

Keep regular private exports outside the repository and test a restore before relying on them. The initial remote export was verified. Support status updates touch only `support_tickets`; they do not change parcel requests or credits.

## Legacy Node service

ParcelMate can also run as one Node service. In that setup it serves the built mobile web app and `/api/*` from the same origin. Use one running instance with a persistent SQLite volume and an HTTPS reverse proxy.

## GitHub repository and Pages history

The source repository lives at `https://github.com/devharish1371/ParcelMate`. The old `docs/` preview is retained as a design artifact. GitHub Pages cannot run the Node API or persist SQLite; the hosted frontend calls the Cloudflare Worker and D1 instead.

The current production build needs one HTTPS Node host with persistent storage and the verified email sender below. A separate Pages frontend would require a new cross-origin authentication and API design. Render's Free web service is not a safe drop-in for this SQLite build because its local files are lost on restarts and redeploys. A free hosted alternative needs a persistent database and backend adaptation before student accounts or credits can be used.

The free hosted path is Cloudflare Workers with D1 and Firebase Authentication. The Node service continues to work locally and on a host with persistent SQLite. See [BUILD_PLAN.md](BUILD_PLAN.md) for the product rules shared by both paths.

## Before launch

1. Run `npm ci`, `npm test`, and `npm run build` locally or in CI.
2. Configure a public HTTPS domain and set `APP_ORIGIN` to that **bare origin** (for example, `https://parcelmate.example` with no path or trailing slash).
3. Configure a Resend API key and verified sender address as `RESEND_API_KEY` and `EMAIL_FROM`. Production startup refuses to run without them. Sign-in remains restricted to `@vitstudent.ac.in`.
4. Provide a persistent writable `DB_PATH`. Do not use an in-memory database or an ephemeral container filesystem for student accounts, requests, tickets, and credits.
5. Decide who may operate technical support. Reports are stored in SQLite and can be reviewed only with server or container access; there is no public admin endpoint.
6. Confirm the college and collection point permit third-party parcel pickup. Do not ask students to put courier OTPs into the app.

## Container example

```bash
docker build -t parcelmate .
docker volume create parcelmate-data
docker run -d --name parcelmate \
  -e APP_ORIGIN=https://parcelmate.example \
  -e RESEND_API_KEY=YOUR_KEY \
  -e 'EMAIL_FROM=ParcelMate <login@parcelmate.example>' \
  -v parcelmate-data:/data \
  -p 127.0.0.1:3001:3001 \
  parcelmate
```

Replace the example domain and credentials before running. Configure the HTTPS reverse proxy to forward requests for that domain to `127.0.0.1:3001`; keep the container port private. `/api/health` is the health endpoint. The app serves `/`, `/verify`, `/logo.svg`, and built assets from `web/dist`.

## Technical support operations

On the host with access to the same database, run:

```bash
npm run support -- list
npm run support -- show TICKET_ID
npm run support -- status TICKET_ID in_review
npm run support -- status TICKET_ID resolved
```

For the container, replace `npm run support --` with `docker exec parcelmate node server/bin/support.mjs`. Operators should read ticket descriptions only on trusted machines. Status changes update the student's report view and never touch requests or credits.

## Data and recovery

Keep regular backups of the persistent SQLite volume. Take a consistent volume snapshot or stop the service before copying the database file. Test restoring a backup before inviting real students. Run one app instance against the SQLite file; do not scale to multiple replicas without moving shared state to a database designed for that deployment.

## Still needed to deploy

The real domain, HTTPS hosting or reverse proxy, Resend credentials, and the support operator are external choices. No deployment is active from this repository alone.
