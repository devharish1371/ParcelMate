import { externalTestingEnabled, verifiedIdentity } from "./auth.js";
import { first, fail, result } from "./db.js";
import { createProfile, profile, walletEntries } from "./profile.js";
import {
  addCircleMember, createCircle, inviteFriend, listNetwork,
  removeCircleMember, respondToInvitation,
} from "./network.js";
import { createRequest, listRequests, transitionRequest } from "./requests.js";
import { closeTrip, createTrip, listTrips } from "./trips.js";
import { listTickets, submitTicket } from "./support.js";

async function readBody(request) {
  const text = await request.text();
  if (text.length > 16_384) throw Object.assign(new Error("Request body too large."), { status: 413 });
  const body = text ? JSON.parse(text) : {};
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyntaxError("Expected a JSON object.");
  return body;
}

function responseFor(value, origin) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return new Response(JSON.stringify(value.body), { status: value.status, headers });
}

async function dispatch(request, env, identity, body) {
  const path = new URL(request.url).pathname;
  const method = request.method;
  const db = env.DB;
  if (path === "/api/me") {
    if (method === "GET") return profile(db, identity);
    if (method === "POST") return createProfile(db, identity, body);
  }
  const user = await first(db, "SELECT id FROM users WHERE id = ? AND email = ?", identity.id, identity.email);
  if (!user) return fail("Finish your student profile.", 404);
  const userId = user.id;
  if (method === "GET" && path === "/api/wallet") return walletEntries(db, userId);
  if (method === "GET" && path === "/api/network") return listNetwork(db, userId);
  if (method === "POST" && path === "/api/network/invitations") return inviteFriend(db, userId, body);
  const invitation = path.match(/^\/api\/network\/invitations\/([a-f0-9-]+)\/(accept|decline)$/);
  if (method === "POST" && invitation) return respondToInvitation(db, userId, invitation[1], invitation[2]);
  if (method === "POST" && path === "/api/network/circles") return createCircle(db, userId, body);
  const addMember = path.match(/^\/api\/network\/circles\/([a-f0-9-]+)\/members$/);
  if (method === "POST" && addMember) return addCircleMember(db, userId, addMember[1], body.friendId);
  const removeMember = path.match(/^\/api\/network\/circles\/([a-f0-9-]+)\/members\/([a-f0-9-]+)$/);
  if (method === "DELETE" && removeMember) return removeCircleMember(db, userId, removeMember[1], removeMember[2]);
  if (method === "GET" && path === "/api/requests") return listRequests(db, userId);
  if (method === "POST" && path === "/api/requests") return createRequest(db, userId, body);
  const action = path.match(/^\/api\/requests\/([a-f0-9-]+)\/(accept|collect|handover|confirm|cancel)$/);
  if (method === "POST" && action) return transitionRequest(db, userId, action[1], action[2]);
  if (method === "GET" && path === "/api/trips") return listTrips(db, userId);
  if (method === "POST" && path === "/api/trips") return createTrip(db, userId, body);
  const close = path.match(/^\/api\/trips\/([a-f0-9-]+)\/close$/);
  if (method === "POST" && close) return closeTrip(db, userId, close[1]);
  if (method === "GET" && path === "/api/support") return listTickets(db, userId);
  if (method === "POST" && path === "/api/support") return submitTicket(db, userId, body);
  return fail("Not found.", 404);
}

export default {
  async fetch(request, env) {
    const requestedOrigin = request.headers.get("Origin");
    const allowedOrigin = (() => {
      if (!requestedOrigin) return null;
      if (requestedOrigin === env.APP_ORIGIN) return requestedOrigin;
      if (requestedOrigin === "http://127.0.0.1:5173") return requestedOrigin;
      // Allow any Cloudflare Pages deployment (production + preview URLs)
      try {
        const { hostname } = new URL(requestedOrigin);
        if (hostname.endsWith(".pages.dev")) return requestedOrigin;
      } catch { /* invalid origin */ }
      return null;
    })();
    if (requestedOrigin && !allowedOrigin) return responseFor(fail("Origin is not allowed.", 403), null);
    if (request.method === "OPTIONS") {
      if (!allowedOrigin) return responseFor(fail("Origin is not allowed.", 403), null);
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
        "Vary": "Origin",
      } });
    }
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/health") {
      return responseFor(result({ ok: true }), allowedOrigin);
    }
    if (request.method === "GET" && path === "/api/access-policy") {
      return responseFor(result({ externalTesting: externalTestingEnabled(env.TEST_EMAIL_ALLOWLIST) }), allowedOrigin);
    }
    if (!path.startsWith("/api/")) return responseFor(fail("Not found.", 404), allowedOrigin);
    const identity = await verifiedIdentity(request, env.FIREBASE_PROJECT_ID, env.TEST_EMAIL_ALLOWLIST);
    if (!identity) return responseFor(fail("Verified college sign-in required.", 401), allowedOrigin);
    try {
      const body = request.method === "POST" ? await readBody(request) : {};
      return responseFor(await dispatch(request, env, identity, body), allowedOrigin);
    } catch (error) {
      if (error instanceof SyntaxError) return responseFor(fail("Invalid JSON body."), allowedOrigin);
      if (error.status === 413) return responseFor(fail(error.message, 413), allowedOrigin);
      console.error("ParcelMate API failure", error);
      return responseFor(fail("Something went wrong.", 500), allowedOrigin);
    }
  },
};
