# ParcelMate

ParcelMate is a mobile web app for verified VIT students to coordinate parcel collection within trusted circles. The current build has college-email sign-in, persistent student accounts, a one-time 2-credit grant, private friends and circles, parcel requests, trip announcements, and technical issue reports.

The web app is deployed through GitHub Pages at [devharish1371.github.io/ParcelMate](https://devharish1371.github.io/ParcelMate/). Its API runs on [Cloudflare Workers](https://parcelmate-api.parcelmate.workers.dev/api/health) with D1 storage. Firebase Authentication supports VIT Google sign-in and college-email/password signup with verification, so this hosted path does not need Resend or a sender domain.

## Install on a phone

Open the Pages link in a phone browser and tap **Install ParcelMate** in the app. On Android Chrome, this can open the browser's install prompt; Chrome's menu also offers **Install app** or **Add to Home screen**. On iPhone, open the link in Safari, tap **Share**, then **Add to Home Screen**. An installed copy opens in its own window. The install provides a home-screen launcher and cached app shell; accounts and parcel data still need an internet connection.

## Run locally

Requires Node.js 24 or newer.

```bash
npm install
npm run dev:server
npm run dev:web
```

Open `http://127.0.0.1:5173/`. Run the server and web commands in separate terminals. Without email delivery settings, sign-up shows a local development verification link. The API stores data in `server/data/parcelmate.sqlite`.

## Hosted account setup

The Pages build sets `VITE_API_ORIGIN` to the Cloudflare Worker URL. The Worker verifies Firebase ID tokens and requires `email_verified: true` plus the exact `@vitstudent.ac.in` email suffix on every protected request. New students can sign in with their VIT Google account or create an email/password account and verify its address; they then add a name and unique student ID. D1 grants two starting credits once when the profile is created.

Firebase's public web configuration is in [web/src/firebase.ts](web/src/firebase.ts). Email/Password and Google must be enabled in Firebase Authentication, and `devharish1371.github.io` must be an authorized domain. The Cloudflare Worker and D1 binding are configured in [wrangler.jsonc](wrangler.jsonc). Run `npm test`, `npm run build`, and `npx wrangler deploy` for the hosted API; pushes to `main` build and deploy the Pages frontend.

## Legacy one-service deployment

Copy `server/.env.example` to `server/.env` and set `APP_ORIGIN`, `RESEND_API_KEY`, and `EMAIL_FROM`. The sender address must be configured with the email provider. Run `npm run build` before `NODE_ENV=production npm start`. Production startup requires a bare HTTPS origin, email delivery settings, a persistent database path, and built web files. The server uses the [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) to deliver one-time links. See [DEPLOYMENT.md](DEPLOYMENT.md) for the container and support review commands.

## Current status

- Working: exact `@vitstudent.ac.in` restriction and verified email checks, unique student ID, sign-out, and one-time starting credits. The hosted path uses Firebase Google or email/password sign-in; the local Node path uses single-use 15-minute links and 30-day HttpOnly sessions.
- Working: verified-student friend invitations, acceptance or decline, private circles, and owner-controlled circle membership. Only accepted friends can be added, and only members can read a circle through the API.
- Working: a minimal parcel-handoff logo and a consistent light/dark theme, with the selected mode saved in the browser.
- Working: circle-only parcel requests, atomic helper acceptance, collection and handover updates, requester receipt confirmation, cancellation before collection, an event trail, and server-side credit reservation and settlement.
- Working: "I'm Going" trip posts limited to private circle members. A member can request pickup from a trip, which reserves one credit and assigns the trip maker as helper. Trips expire two hours after their scheduled time; a trip with active pickups cannot be closed.
- Working: wallet credit activity and a technical issue form. Reports are stored separately from parcel requests and credit entries; students can see their own reports.
- Working: hosted Worker origin checks and token validation; local Node production static serving, a per-email sign-in link limit, a container recipe, and a local support review command. Technical reports can be marked in review or resolved by an operator with database access.
- Hosted path: Cloudflare Worker/D1 and Firebase Authentication. The prior Node/SQLite/Resend implementation remains available for local development and one-service deployments.
- Next: enable the Firebase Google provider, verify an end-to-end sign-in with a real `@vitstudent.ac.in` Google account, assign a support operator, and establish a D1 export/restore routine. Email/password verification delivery to VIT inboxes still needs separate confirmation.
- The existing Figma Make `.make` archive remains the design and workflow reference.

See [BUILD_PLAN.md](BUILD_PLAN.md) for the delivery sequence and product rules.
