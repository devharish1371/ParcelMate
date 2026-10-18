import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
const { db, walletFor } = await import("../src/db.js");
const { addCircleMember, createCircle, removeCircleMember } = await import("../src/network.js");
const { createRequest, listRequests, transitionRequest } = await import("../src/requests.js");

function student(id) {
  db.prepare(`
    INSERT INTO users (id, email, student_id, name, verified_at, created_at)
    VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')
  `).run(id, `${id}@vitstudent.ac.in`, `ID-${id}`, id.toUpperCase());
  db.prepare(`
    INSERT INTO credit_entries (id, user_id, reason, available_delta, created_at)
    VALUES (?, ?, 'welcome', 2, '2026-01-01')
  `).run(`welcome-${id}`, id);
}

function connect(owner, friend, circleId) {
  const [userA, userB] = [owner, friend].sort();
  db.prepare("INSERT INTO friendships (user_a, user_b, created_at) VALUES (?, ?, '2026-01-01')")
    .run(userA, userB);
  assert.equal(addCircleMember(owner, circleId, friend).ok, true);
}

test("private request flow reserves and transfers exactly one credit", () => {
  for (const id of ["owner", "helper", "other", "outsider"]) student(id);
  const circleId = createCircle("owner", "Hostel").circleId;
  connect("owner", "helper", circleId);
  connect("owner", "other", circleId);

  assert.equal(createRequest("outsider", { circleId, parcelLabel: "Books", collectionPoint: "Gate" }).status, 404);
  const request = createRequest("owner", { circleId, parcelLabel: "Books", collectionPoint: "Main gate" });
  assert.equal(request.ok, true);
  assert.equal(walletFor("owner").available, 1);
  assert.equal(walletFor("owner").reserved, 1);
  assert.equal(listRequests("outsider").length, 0);
  assert.equal(listRequests("helper")[0].status, "open");
  assert.equal(transitionRequest("owner", request.requestId, "accept").status, 403);
  assert.equal(transitionRequest("outsider", request.requestId, "accept").status, 404);
  const accepted = transitionRequest("helper", request.requestId, "accept");
  assert.equal(accepted.ok, true);
  assert.equal(accepted.requestStatus, "accepted");
  assert.equal("status" in accepted, false);
  assert.equal(transitionRequest("other", request.requestId, "accept").status, 409);
  assert.equal(removeCircleMember("owner", circleId, "helper").status, 409);
  assert.equal(transitionRequest("owner", request.requestId, "collect").status, 403);
  assert.equal(transitionRequest("helper", request.requestId, "collect").ok, true);
  assert.equal(transitionRequest("owner", request.requestId, "cancel").status, 409);
  assert.equal(transitionRequest("helper", request.requestId, "handover").ok, true);
  assert.equal(transitionRequest("helper", request.requestId, "confirm").status, 403);
  assert.equal(transitionRequest("owner", request.requestId, "confirm").ok, true);
  assert.equal(transitionRequest("owner", request.requestId, "confirm").status, 409);
  assert.deepEqual({ ...walletFor("owner") }, { available: 1, reserved: 0, earned: 0, spent: 1 });
  assert.deepEqual({ ...walletFor("helper") }, { available: 3, reserved: 0, earned: 1, spent: 0 });
  assert.equal(listRequests("owner")[0].status, "completed");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM request_events WHERE request_id = ?")
    .get(request.requestId).count, 5);
  assert.equal(removeCircleMember("owner", circleId, "helper").ok, true);
  assert.equal(listRequests("helper").length, 0);
});

test("cancellation before collection releases the reserved credit", () => {
  student("cancel-owner");
  student("cancel-helper");
  const circleId = createCircle("cancel-owner", "College").circleId;
  connect("cancel-owner", "cancel-helper", circleId);
  const requestId = createRequest("cancel-owner", {
    circleId, parcelLabel: "Clothes", collectionPoint: "Parcel office",
  }).requestId;
  assert.equal(transitionRequest("cancel-helper", requestId, "accept").ok, true);
  assert.equal(transitionRequest("cancel-owner", requestId, "cancel").ok, true);
  assert.equal(transitionRequest("cancel-owner", requestId, "cancel").status, 409);
  assert.deepEqual({ ...walletFor("cancel-owner") }, { available: 2, reserved: 0, earned: 0, spent: 0 });
  assert.equal(walletFor("cancel-helper").earned, 0);
  assert.equal(listRequests("cancel-helper")[0].status, "cancelled");
  assert.equal(removeCircleMember("cancel-owner", circleId, "cancel-helper").ok, true);
});

test("requests require an available credit", () => {
  student("low-credit");
  const circleId = createCircle("low-credit", "Floor").circleId;
  for (let index = 0; index < 2; index++) {
    assert.equal(createRequest("low-credit", {
      circleId, parcelLabel: `Parcel ${index}`, collectionPoint: "Gate",
    }).ok, true);
  }
  assert.equal(createRequest("low-credit", {
    circleId, parcelLabel: "Third parcel", collectionPoint: "Gate",
  }).status, 409);
  assert.deepEqual({ ...walletFor("low-credit") }, { available: 0, reserved: 2, earned: 0, spent: 0 });
});
