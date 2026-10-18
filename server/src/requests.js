import { randomUUID } from "node:crypto";
import { db, walletFor } from "./db.js";

function fail(error, status = 400) {
  return { error, status };
}

function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function circleMember(circleId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?")
    .get(circleId, userId));
}

function cleanText(value, min, max) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= min && text.length <= max ? text : null;
}

function event(requestId, actorId, eventType, now) {
  db.prepare(`
    INSERT INTO request_events (id, request_id, actor_id, event_type, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), requestId, actorId, eventType, now);
}

function credit(userId, requestId, reason, available, reserved, earned, spent, now) {
  db.prepare(`
    INSERT INTO credit_entries
      (id, user_id, request_id, reason, available_delta, reserved_delta,
       earned_delta, spent_delta, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), userId, requestId, reason, available, reserved, earned, spent, now);
}

export function listRequests(userId) {
  return db.prepare(`
    SELECT requests.id, requests.circle_id AS circleId, circles.name AS circleName,
      requests.requester_id AS requesterId, requester.name AS requesterName,
      requests.helper_id AS helperId, helper.name AS helperName,
      trip_requests.trip_id AS tripId,
      requests.parcel_label AS parcelLabel, requests.collection_point AS collectionPoint,
      requests.note, requests.status, requests.created_at AS createdAt,
      requests.updated_at AS updatedAt
    FROM parcel_requests AS requests
    JOIN circle_members AS member ON member.circle_id = requests.circle_id
    JOIN circles ON circles.id = requests.circle_id
    JOIN users AS requester ON requester.id = requests.requester_id
    LEFT JOIN users AS helper ON helper.id = requests.helper_id
    LEFT JOIN trip_requests ON trip_requests.request_id = requests.id
    WHERE member.user_id = ?
    ORDER BY requests.created_at DESC
  `).all(userId);
}

export function createRequest(userId, input) {
  const tripId = typeof input.tripId === "string" ? input.tripId : "";
  const selectedCircleId = typeof input.circleId === "string" ? input.circleId : "";
  const parcelLabel = cleanText(input.parcelLabel, 2, 80);
  const selectedPoint = tripId ? null : cleanText(input.collectionPoint, 2, 80);
  const note = input.note === undefined || input.note === "" ? "" : cleanText(input.note, 0, 240);
  if (!parcelLabel || (!tripId && !selectedPoint) || note === null) {
    return fail("Add a parcel label and collection point. Keep the note under 240 characters.");
  }
  return transaction(() => {
    let circleId = selectedCircleId;
    let collectionPoint = selectedPoint;
    let helperId = null;
    if (tripId) {
      const trip = db.prepare("SELECT * FROM trips WHERE id = ?").get(tripId);
      if (!trip || trip.status !== "open" ||
          Date.parse(trip.scheduled_at) + 2 * 60 * 60 * 1000 <= Date.now()) {
        return fail("This trip is no longer available.", 404);
      }
      if (trip.owner_id === userId) return fail("You cannot request pickup from your own trip.", 403);
      if (!circleMember(trip.circle_id, trip.owner_id)) return fail("This trip is no longer available.", 404);
      circleId = trip.circle_id;
      collectionPoint = trip.collection_point;
      helperId = trip.owner_id;
    }
    if (!circleMember(circleId, userId)) return fail("Circle is unavailable.", 404);
    if (walletFor(userId).available < 1) return fail("You need 1 available credit to request help.", 409);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO parcel_requests
        (id, circle_id, requester_id, helper_id, parcel_label, collection_point, note, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, circleId, userId, helperId, parcelLabel, collectionPoint, note,
      helperId ? "accepted" : "open", now, now);
    if (tripId) db.prepare("INSERT INTO trip_requests (trip_id, request_id) VALUES (?, ?)").run(tripId, id);
    credit(userId, id, "request_reserved", -1, 1, 0, 0, now);
    event(id, userId, "created", now);
    if (tripId) event(id, userId, "trip_assigned", now);
    return { ok: true, requestId: id };
  });
}

export function transitionRequest(userId, requestId, action) {
  if (!["accept", "collect", "handover", "confirm", "cancel"].includes(action)) {
    return fail("Unknown request action.", 404);
  }
  return transaction(() => {
    const request = db.prepare("SELECT * FROM parcel_requests WHERE id = ?").get(requestId);
    if (!request || !circleMember(request.circle_id, userId)) return fail("Request is unavailable.", 404);
    const now = new Date().toISOString();
    let nextStatus;

    if (action === "accept") {
      if (request.status !== "open") return fail("This request is no longer open.", 409);
      if (request.requester_id === userId) return fail("You cannot accept your own request.", 403);
      nextStatus = "accepted";
      db.prepare("UPDATE parcel_requests SET helper_id = ?, status = ?, updated_at = ? WHERE id = ?")
        .run(userId, nextStatus, now, requestId);
    } else if (action === "collect" || action === "handover") {
      if (request.helper_id !== userId) return fail("Only the assigned helper can update collection.", 403);
      const expected = action === "collect" ? "accepted" : "collected";
      if (request.status !== expected) return fail("This step is not available yet.", 409);
      nextStatus = action === "collect" ? "collected" : "handed_over";
      db.prepare("UPDATE parcel_requests SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, now, requestId);
    } else if (action === "confirm") {
      if (request.requester_id !== userId) return fail("Only the requester can confirm receipt.", 403);
      if (request.status !== "handed_over") return fail("The parcel has not been marked handed over.", 409);
      nextStatus = "completed";
      db.prepare("UPDATE parcel_requests SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, now, requestId);
      credit(request.requester_id, requestId, "request_spent", 0, -1, 0, 1, now);
      credit(request.helper_id, requestId, "help_earned", 1, 0, 1, 0, now);
    } else {
      if (request.requester_id !== userId) return fail("Only the requester can cancel.", 403);
      if (!["open", "accepted"].includes(request.status)) {
        return fail("Cancellation is available only before collection.", 409);
      }
      nextStatus = "cancelled";
      db.prepare("UPDATE parcel_requests SET status = ?, updated_at = ? WHERE id = ?")
        .run(nextStatus, now, requestId);
      credit(request.requester_id, requestId, "request_released", 1, -1, 0, 0, now);
    }
    event(requestId, userId, action, now);
    return { ok: true, requestStatus: nextStatus };
  });
}
