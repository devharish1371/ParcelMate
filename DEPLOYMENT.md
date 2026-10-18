# ParcelMate deployment

ParcelMate runs as one Node service. In production it serves the built mobile web app and `/api/*` from the same origin. Use one running instance with a persistent SQLite volume. Put an HTTPS reverse proxy in front of it.

## GitHub repository and Pages

The source repository can live at `https://github.com/devharish1371/ParcelMate`. GitHub Pages publishes static files, so it cannot run the current Node API or persist the SQLite database. Publishing only `web/dist` to Pages would show a sign-in form whose `/api/*` calls fail. Do not present that as a working launch.

The current production build needs one HTTPS Node host with persistent storage and the verified email sender below. A separate Pages frontend would require a new cross-origin authentication and API design. Render's Free web service is not a safe drop-in for this SQLite build because its local files are lost on restarts and redeploys. A free hosted alternative needs a persistent database and backend adaptation before student accounts or credits can be used.

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
