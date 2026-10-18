import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createProfile, profile, walletEntries } from "../src/profile.js";
import { addCircleMember, createCircle, inviteFriend, listNetwork, respondToInvitation } from "../src/network.js";
import { createRequest, listRequests, transitionRequest } from "../src/requests.js";
import { createTrip, listTrips } from "../src/trips.js";
import { listTickets, submitTicket } from "../src/support.js";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function localD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec(schema);
  const prepare = (sql) => ({
    bind: (...args) => {
      const statement = sqlite.prepare(sql);
      return {
        first: async () => statement.get(...args) || null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: { changes: statement.run(...args).changes } }),
      };
    },
  });
  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const outcomes = [];
        for (const statement of statements) outcomes.push(await statement.run());
        sqlite.exec("COMMIT");
        return outcomes;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => sqlite.close(),
  };
}

test("hosted handlers keep friends, requests, credits, trips, and support scoped", async () => {
  const db = localD1();
  const a = { id: "firebase-a", email: "a@vitstudent.ac.in" };
  const b = { id: "firebase-b", email: "b@vitstudent.ac.in" };
  assert.equal((await createProfile(db, a, { name: "A Student", studentId: "24A001" })).status, 200);
  assert.equal((await createProfile(db, b, { name: "B Student", studentId: "24B001" })).status, 200);
  assert.equal((await createProfile(db, a, { name: "A Student", studentId: "24A001" })).body.user.wallet.available, 2);
  assert.equal((await profile(db, a)).body.user.wallet.available, 2);

  assert.equal((await inviteFriend(db, a.id, { email: b.email })).status, 200);
  const invitation = (await listNetwork(db, b.id)).body.invitations[0];
  assert.equal((await respondToInvitation(db, b.id, invitation.id, "accept")).status, 200);
  const circleId = (await createCircle(db, a.id, { name: "Close Friends" })).body.circleId;
  assert.equal((await addCircleMember(db, a.id, circleId, b.id)).status, 200);
  assert.equal((await listNetwork(db, b.id)).body.circles[0].id, circleId);

  const requestId = (await createRequest(db, a.id, {
    circleId, parcelLabel: "Books", collectionPoint: "Main gate", note: "",
  })).body.requestId;
  assert.equal((await profile(db, a)).body.user.wallet.reserved, 1);
  assert.equal((await listRequests(db, b.id)).body.requests[0].id, requestId);
  assert.equal((await transitionRequest(db, a.id, requestId, "accept")).status, 403);
  assert.equal((await transitionRequest(db, b.id, requestId, "accept")).status, 200);
  assert.equal((await transitionRequest(db, b.id, requestId, "collect")).status, 200);
  assert.equal((await transitionRequest(db, b.id, requestId, "handover")).status, 200);
  assert.equal((await transitionRequest(db, a.id, requestId, "confirm")).status, 200);
  assert.equal((await profile(db, a)).body.user.wallet.spent, 1);
  assert.equal((await profile(db, b)).body.user.wallet.earned, 1);

  const trip = await createTrip(db, b.id, {
    circleId, collectionPoint: "Main gate", scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), note: "",
  });
  assert.equal(trip.status, 200);
  assert.equal((await listTrips(db, a.id)).body.trips[0].available, true);
  const pickup = await createRequest(db, a.id, { tripId: trip.body.tripId, parcelLabel: "Notebook", note: "" });
  assert.equal(pickup.status, 200);
  assert.equal((await listRequests(db, a.id)).body.requests[0].helperId, b.id);

  const before = (await profile(db, a)).body.user.wallet;
  assert.equal((await submitTicket(db, a.id, { category: "display", description: "The light theme text is hard to read." })).status, 200);
  assert.equal((await listTickets(db, b.id)).body.tickets.length, 0);
  assert.deepEqual({ ...(await profile(db, a)).body.user.wallet }, { ...before });
  assert.equal((await walletEntries(db, a.id)).body.entries.length > 0, true);
  db.close();
});
