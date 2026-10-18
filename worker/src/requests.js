import { all, cleanText, fail, first, id, member, now, result, run } from "./db.js";

export async function listRequests(db, userId) {
  return result({ requests: await all(db, `
    SELECT r.id, r.circle_id AS circleId, circles.name AS circleName,
      r.requester_id AS requesterId, requester.name AS requesterName,
      r.helper_id AS helperId, helper.name AS helperName,
      trip_requests.trip_id AS tripId, r.parcel_label AS parcelLabel,
      r.collection_point AS collectionPoint, r.note, r.status,
      r.created_at AS createdAt, r.updated_at AS updatedAt
    FROM parcel_requests r
    JOIN circle_members mine ON mine.circle_id = r.circle_id
    JOIN circles ON circles.id = r.circle_id
    JOIN users requester ON requester.id = r.requester_id
    LEFT JOIN users helper ON helper.id = r.helper_id
    LEFT JOIN trip_requests ON trip_requests.request_id = r.id
    WHERE mine.user_id = ? ORDER BY r.created_at DESC LIMIT 100
  `, userId) });
}

export async function createRequest(db, userId, input) {
  const tripId = typeof input.tripId === "string" ? input.tripId : "";
  const parcelLabel = cleanText(input.parcelLabel, 2, 80);
  const note = input.note === undefined || input.note === "" ? "" : cleanText(input.note, 0, 240);
  let circleId = typeof input.circleId === "string" ? input.circleId : "";
  let collectionPoint = cleanText(input.collectionPoint, 2, 80);
  let helperId = null;
  if (!parcelLabel || note === null) return fail("Add a parcel label and keep the note under 240 characters.");
  if (tripId) {
    const trip = await first(db, "SELECT * FROM trips WHERE id = ?", tripId);
    if (!trip || trip.status !== "open" || Date.parse(trip.scheduled_at) + 2 * 60 * 60 * 1000 <= Date.now()) {
      return fail("This trip is no longer available.", 404);
    }
    if (trip.owner_id === userId) return fail("You cannot request pickup from your own trip.", 403);
    if (!await member(db, trip.circle_id, trip.owner_id)) return fail("This trip is no longer available.", 404);
    circleId = trip.circle_id;
    collectionPoint = trip.collection_point;
    helperId = trip.owner_id;
  }
  if (!collectionPoint) return fail("Add a collection point.");
  if (!await member(db, circleId, userId)) return fail("Circle is unavailable.", 404);
  const requestId = id();
  const timestamp = now();
  const status = helperId ? "accepted" : "open";
  const insert = tripId
    ? db.prepare(`INSERT INTO parcel_requests
        (id, circle_id, requester_id, helper_id, parcel_label, collection_point, note, status, created_at, updated_at)
        SELECT ?, trips.circle_id, ?, trips.owner_id, ?, trips.collection_point, ?, 'accepted', ?, ?
        FROM trips JOIN circle_members mine ON mine.circle_id = trips.circle_id
        WHERE trips.id = ? AND trips.status = 'open' AND trips.scheduled_at > ?
          AND mine.user_id = ?`)
      .bind(requestId, userId, parcelLabel, note, timestamp, timestamp, tripId,
        new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), userId)
    : db.prepare(`INSERT INTO parcel_requests
        (id, circle_id, requester_id, helper_id, parcel_label, collection_point, note, status, created_at, updated_at)
        SELECT ?, circle_id, ?, NULL, ?, ?, ?, ?, ?, ? FROM circle_members
        WHERE circle_id = ? AND user_id = ?`)
      .bind(requestId, userId, parcelLabel, collectionPoint, note, status, timestamp, timestamp, circleId, userId);
  const statements = [insert];
  if (tripId) statements.push(db.prepare("INSERT INTO trip_requests (trip_id, request_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM parcel_requests WHERE id = ?)")
    .bind(tripId, requestId, requestId));
  statements.push(db.prepare("INSERT INTO request_events (id, request_id, actor_id, event_type, created_at) SELECT ?, ?, ?, 'created', ? WHERE EXISTS (SELECT 1 FROM parcel_requests WHERE id = ?)")
    .bind(id(), requestId, userId, timestamp, requestId));
  try {
    const outcomes = await db.batch(statements);
    if (outcomes[0].meta.changes !== 1) return fail("This trip is no longer available.", 404);
    return result({ ok: true, requestId });
  } catch (error) {
    if (/CHECK constraint failed/.test(String(error))) return fail("You need 1 available credit to request help.", 409);
    throw error;
  }
}

export async function transitionRequest(db, userId, requestId, action) {
  if (!["accept", "collect", "handover", "confirm", "cancel"].includes(action)) {
    return fail("Unknown request action.", 404);
  }
  const request = await first(db, "SELECT * FROM parcel_requests WHERE id = ?", requestId);
  if (!request || !await member(db, request.circle_id, userId)) return fail("Request is unavailable.", 404);
  const timestamp = now();
  let update;
  let status;
  if (action === "accept") {
    if (request.requester_id === userId) return fail("You cannot accept your own request.", 403);
    status = "accepted";
    update = db.prepare(`UPDATE parcel_requests SET helper_id = ?, status = 'accepted', updated_at = ?
      WHERE id = ? AND status = 'open' AND requester_id <> ?
        AND EXISTS (SELECT 1 FROM circle_members WHERE circle_id = parcel_requests.circle_id AND user_id = ?)`)
      .bind(userId, timestamp, requestId, userId, userId);
  } else if (action === "collect" || action === "handover") {
    if (request.helper_id !== userId) return fail("Only the assigned helper can update collection.", 403);
    const expected = action === "collect" ? "accepted" : "collected";
    status = action === "collect" ? "collected" : "handed_over";
    update = db.prepare(`UPDATE parcel_requests SET status = ?, updated_at = ?
      WHERE id = ? AND status = ? AND helper_id = ?`)
      .bind(status, timestamp, requestId, expected, userId);
  } else if (action === "confirm") {
    if (request.requester_id !== userId) return fail("Only the requester can confirm receipt.", 403);
    status = "completed";
    update = db.prepare(`UPDATE parcel_requests SET status = 'completed', updated_at = ?
      WHERE id = ? AND status = 'handed_over' AND requester_id = ?`)
      .bind(timestamp, requestId, userId);
  } else {
    if (request.requester_id !== userId) return fail("Only the requester can cancel.", 403);
    status = "cancelled";
    update = db.prepare(`UPDATE parcel_requests SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND status IN ('open', 'accepted') AND requester_id = ?`)
      .bind(timestamp, requestId, userId);
  }
  const outcome = await update.run();
  if (outcome.meta.changes !== 1) return fail("This step is no longer available.", 409);
  await run(db, "INSERT INTO request_events (id, request_id, actor_id, event_type, created_at) VALUES (?, ?, ?, ?, ?)",
    id(), requestId, userId, action, timestamp);
  return result({ ok: true, requestStatus: status });
}
