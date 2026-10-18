# ParcelMate build plan

## Product decision

Build a mobile web app for verified `vitstudent.ac.in` students. Use the Figma Make export as the visual and navigation reference. The first version has real accounts and a shared server database, rather than client-only sample data.

## Core rules

- Every verified student receives 2 starting credits once.
- Requests are visible only to members of the selected private circle.
- Creating a request reserves 1 available credit.
- A request can have only one helper. Acceptance must be atomic on the server.
- The helper marks collection and handover; only the requester confirms receipt.
- Confirmation spends the requester's reserved credit and grants the helper 1 credit in one transaction.
- Cancellation before collection returns the reserved credit. Later exception handling needs a separate product decision.
- Technical Support records app problems only. It never changes a parcel request or credits.
- Do not store courier OTPs, handle money, or list requests publicly.

## Architecture

- `web/`: React, TypeScript, Vite, responsive mobile-first UI adapted from the `.make` prototype.
- `server/`: Node.js API using built-in HTTP and SQLite, with server-owned permissions and credit transactions.
- Sign-in: college email verification link; server session in an HttpOnly cookie. Student ID is unique in the database. Production email delivery uses a server-side Resend API key supplied later.
- Shared records: students, sessions, circles, circle members, friendships or invitations, requests, status events, credit ledger, trip announcements, and technical support tickets.
- Keep credit totals derived from ledger/reservations or changed only through database transactions. Never let a browser submit a balance directly.

## Delivery stages

1. **Foundation:** import the prototype into `web/`, establish the API and database, add environment examples and local run commands.
2. **Identity:** email verification, unique student ID, one-time starting credits, sign-in and sign-out, protected app routes.
3. **Trusted network:** friend invitations, private circles, and circle membership. Complete in the current build.
4. **Parcel flow:** circle-only request visibility; create, reserve, accept, collect, hand over, confirm, cancel before collection, and record an audit trail. Complete in the current build.
5. **Supporting screens:** wallet, activity, I'm Going, profile, empty states, and technical issue reports. Complete in the current build; reports are stored for a later support review process.
6. **Quality and launch:** role and credit tests, mobile UI review, a production service, container recipe, and local support review commands are in place. Real Resend credentials, public HTTPS hosting, backups, and deployment remain.

## First build slice

Create the runnable web and server projects. Implement email account creation and verification, persistent sessions, the starting-credit grant, and a protected dashboard. Keep the existing prototype screens as the UI reference while replacing demo-only account state with API data.

## Open items

- The source is published at `devharish1371/ParcelMate`, and GitHub Pages now hosts a clearly labeled preview from `docs/`.
- The free production path is GitHub Pages for the app frontend, Cloudflare Workers and D1 for the API and persistent data, and Firebase Authentication email/password with verification emails. This replaces the current Node-only API and Resend magic links for production. Firebase's no-cost email-link sign-in limit is too low for general student use, so the free path uses verified email/password accounts.
- The Worker must validate Firebase ID token signatures and claims, including `email_verified` and the exact `@vitstudent.ac.in` suffix, on every protected request. D1 must keep circle permissions and credit changes atomic on the server. The browser must never set a balance or choose an authorized user ID.
- The Cloudflare and Firebase projects need to be created before deployment. Their public project configuration can be added to the web build; secrets and service credentials must stay out of Git.
- College or courier permission for third-party parcel pickup remains a real-world policy dependency.
