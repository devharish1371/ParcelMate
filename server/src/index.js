import { createServer } from "node:http";
import { config, hasEmailDelivery, validateProductionConfig } from "./config.js";
import { db } from "./db.js";
import { logout, publicUser, sessionFromRequest, startLogin, verifyLogin } from "./auth.js";
import {
  addCircleMember,
  createCircle,
  inviteFriend,
  listNetwork,
  removeCircleMember,
  respondToInvitation,
} from "./network.js";
import { createRequest, listRequests, transitionRequest } from "./requests.js";
import { closeTrip, createTrip, listTrips } from "./trips.js";
import { listTickets, submitTicket } from "./support.js";
import { serveWeb } from "./web.js";

validateProductionConfig();

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Request body too large");
  }
  const parsed = body ? JSON.parse(body) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SyntaxError("Request body must be an object");
  }
  return parsed;
}

function sessionCookie(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `parcelmate_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`;
}

export const server = createServer(async (request, response) => {
  const path = new URL(request.url || "/", config.appOrigin).pathname;
  const mutating = request.method === "POST" || request.method === "PUT" ||
    request.method === "PATCH" || request.method === "DELETE";
  if ((request.headers.origin && request.headers.origin !== config.appOrigin) ||
      (process.env.NODE_ENV === "production" && mutating && request.headers.origin !== config.appOrigin)) {
    json(response, 403, { error: "Origin is not allowed." });
    return;
  }

  try {
    if (request.method === "GET" && await serveWeb(path, response)) return;
    if (request.method === "GET" && path === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && path === "/api/auth/start") {
      const result = await startLogin(await readJson(request));
      json(response, result.status || 200, result);
      return;
    }
    if (request.method === "POST" && path === "/api/auth/verify") {
      const result = verifyLogin((await readJson(request)).token);
      if (!result) {
        json(response, 400, { error: "This sign-in link is invalid or expired." });
        return;
      }
      json(response, 200, { user: publicUser(result.user) }, {
        "Set-Cookie": sessionCookie(result.sessionToken),
      });
      return;
    }
    if (request.method === "GET" && path === "/api/me") {
      const user = sessionFromRequest(request);
      json(response, user ? 200 : 401, user
        ? { user: publicUser(user) }
        : { error: "Sign in required." });
      return;
    }
    if (request.method === "POST" && path === "/api/auth/logout") {
      logout(request);
      json(response, 200, { ok: true }, {
        "Set-Cookie": `parcelmate_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      });
      return;
    }
    if (path.startsWith("/api/network")) {
      const user = sessionFromRequest(request);
      if (!user) {
        json(response, 401, { error: "Sign in required." });
        return;
      }
      if (request.method === "GET" && path === "/api/network") {
        json(response, 200, listNetwork(user.id));
        return;
      }
      if (request.method === "POST" && path === "/api/network/invitations") {
        const result = inviteFriend(user.id, (await readJson(request)).email);
        json(response, result.status || 200, result);
        return;
      }
      const invitation = path.match(/^\/api\/network\/invitations\/([a-f0-9-]+)\/(accept|decline)$/);
      if (request.method === "POST" && invitation) {
        const result = respondToInvitation(user.id, invitation[1], invitation[2]);
        json(response, result.status || 200, result);
        return;
      }
      if (request.method === "POST" && path === "/api/network/circles") {
        const result = createCircle(user.id, (await readJson(request)).name);
        json(response, result.status || 200, result);
        return;
      }
      const addMember = path.match(/^\/api\/network\/circles\/([a-f0-9-]+)\/members$/);
      if (request.method === "POST" && addMember) {
        const result = addCircleMember(user.id, addMember[1], (await readJson(request)).friendId);
        json(response, result.status || 200, result);
        return;
      }
      const removeMember = path.match(/^\/api\/network\/circles\/([a-f0-9-]+)\/members\/([a-f0-9-]+)$/);
      if (request.method === "DELETE" && removeMember) {
        const result = removeCircleMember(user.id, removeMember[1], removeMember[2]);
        json(response, result.status || 200, result);
        return;
      }
    }
    if (path.startsWith("/api/requests")) {
      const user = sessionFromRequest(request);
      if (!user) {
        json(response, 401, { error: "Sign in required." });
        return;
      }
      if (request.method === "GET" && path === "/api/requests") {
        json(response, 200, { requests: listRequests(user.id) });
        return;
      }
      if (request.method === "POST" && path === "/api/requests") {
        const result = createRequest(user.id, await readJson(request));
        json(response, result.status || 200, result);
        return;
      }
      const action = path.match(/^\/api\/requests\/([a-f0-9-]+)\/(accept|collect|handover|confirm|cancel)$/);
      if (request.method === "POST" && action) {
        const result = transitionRequest(user.id, action[1], action[2]);
        json(response, result.status || 200, result);
        return;
      }
    }
    if (path.startsWith("/api/trips")) {
      const user = sessionFromRequest(request);
      if (!user) {
        json(response, 401, { error: "Sign in required." });
        return;
      }
      if (request.method === "GET" && path === "/api/trips") {
        json(response, 200, { trips: listTrips(user.id) });
        return;
      }
      if (request.method === "POST" && path === "/api/trips") {
        const result = createTrip(user.id, await readJson(request));
        json(response, result.status || 200, result);
        return;
      }
      const close = path.match(/^\/api\/trips\/([a-f0-9-]+)\/close$/);
      if (request.method === "POST" && close) {
        const result = closeTrip(user.id, close[1]);
        json(response, result.status || 200, result);
        return;
      }
    }
    if (path.startsWith("/api/support")) {
      const user = sessionFromRequest(request);
      if (!user) {
        json(response, 401, { error: "Sign in required." });
        return;
      }
      if (request.method === "GET" && path === "/api/support") {
        json(response, 200, { tickets: listTickets(user.id) });
        return;
      }
      if (request.method === "POST" && path === "/api/support") {
        const result = submitTicket(user.id, await readJson(request));
        json(response, result.status || 200, result);
        return;
      }
    }
    if (request.method === "GET" && path === "/api/wallet") {
      const user = sessionFromRequest(request);
      if (!user) {
        json(response, 401, { error: "Sign in required." });
        return;
      }
      json(response, 200, { entries: db.prepare(`
        SELECT reason, available_delta AS availableDelta, reserved_delta AS reservedDelta,
          earned_delta AS earnedDelta, spent_delta AS spentDelta, created_at AS createdAt
        FROM credit_entries WHERE user_id = ? ORDER BY created_at DESC
      `).all(user.id) });
      return;
    }
    json(response, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof SyntaxError) {
      json(response, 400, { error: "Invalid JSON body." });
    } else if (error instanceof Error && error.message === "Request body too large") {
      json(response, 413, { error: error.message });
    } else {
      console.error("Request failed", error);
      json(response, 500, { error: "Something went wrong." });
    }
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(config.port, config.host, () => {
    console.log(`ParcelMate API listening on http://${config.host}:${config.port}`);
    if (!hasEmailDelivery) console.log("Development email links are returned by /api/auth/start.");
  });
}

process.on("SIGINT", () => {
  db.close();
  process.exit(0);
});
