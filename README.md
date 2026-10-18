# ParcelMate

ParcelMate is a mobile web app for verified VIT students to coordinate parcel collection within trusted circles. The current build has college-email sign-in, persistent student accounts, a one-time 2-credit grant, private friends and circles, parcel requests, trip announcements, and technical issue reports.

The [GitHub Pages preview](https://devharish1371.github.io/ParcelMate/) introduces the design and clearly marks sign-in as pending. The live app still needs its API, persistent data, and a configured email sender.

## Run locally

Requires Node.js 24 or newer.

```bash
npm install
npm run dev:server
npm run dev:web
```

Open `http://127.0.0.1:5173/`. Run the server and web commands in separate terminals. Without email delivery settings, sign-up shows a local development verification link. The API stores data in `server/data/parcelmate.sqlite`.

## Verification email in production

Copy `server/.env.example` to `server/.env` and set `APP_ORIGIN`, `RESEND_API_KEY`, and `EMAIL_FROM`. The sender address must be configured with the email provider. Run `npm run build` before `NODE_ENV=production npm start`. Production startup requires a bare HTTPS origin, email delivery settings, a persistent database path, and built web files. The server uses the [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) to deliver one-time links. See [DEPLOYMENT.md](DEPLOYMENT.md) for the container and support review commands.

## Current status

- Working: exact `@vitstudent.ac.in` email restriction at sign-in and session validation, unique student ID, single-use 15-minute verification links, 30-day HttpOnly sessions, sign-out, and one-time starting credits.
- Working: verified-student friend invitations, acceptance or decline, private circles, and owner-controlled circle membership. Only accepted friends can be added, and only members can read a circle through the API.
- Working: a minimal parcel-handoff logo and a consistent light/dark theme, with the selected mode saved in the browser.
- Working: circle-only parcel requests, atomic helper acceptance, collection and handover updates, requester receipt confirmation, cancellation before collection, an event trail, and server-side credit reservation and settlement.
- Working: "I'm Going" trip posts limited to private circle members. A member can request pickup from a trip, which reserves one credit and assigns the trip maker as helper. Trips expire two hours after their scheduled time; a trip with active pickups cannot be closed.
- Working: wallet credit activity and a technical issue form. Reports are stored separately from parcel requests and credit entries; students can see their own reports.
- Working: production static serving, HTTPS origin checks, a per-email sign-in link limit, a container recipe, and a local support review command. Technical reports can be marked in review or resolved by an operator with server access.
- Next: connect real email credentials, choose a public HTTPS host and persistent volume, assign a support operator, test backups, and deploy. GitHub Pages alone cannot host the API or SQLite data, so no public deployment is active yet.
- The existing Figma Make `.make` archive remains the design and workflow reference.

See [BUILD_PLAN.md](BUILD_PLAN.md) for the delivery sequence and product rules.
