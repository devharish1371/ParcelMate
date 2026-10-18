import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const HOUR = 60 * 60 * 1000;

function fail(error, status = 400) {
  return { error, status };
}

function member(circleId, userId) {
  return Boolean(db.prepare("SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?")
    .get(circleId, userId));
}

export function listTrips(userId) {
  return db.prepare(`
    SELECT trips.id, trips.circle_id AS circleId, circles.name AS circleName,
      trips.owner_id AS ownerId, users.name AS ownerName,
      trips.collection_point AS collectionPoint, trips.note,
      trips.scheduled_at AS scheduledAt, trips.status,
      trips.created_at AS createdAt,
      (SELECT COUNT(*) FROM trip_requests
        JOIN parcel_requests ON parcel_requests.id = trip_requests.request_id
        WHERE trip_requests.trip_id = trips.id AND parcel_requests.status <> 'cancelled') AS requestCount
    FROM trips
    JOIN circle_members AS mine ON mine.circle_id = trips.circle_id
    JOIN circles ON circles.id = trips.circle_id
    JOIN users ON users.id = trips.owner_id
    WHERE mine.user_id = ?
    ORDER BY trips.scheduled_at DESC
    LIMIT 50
  `).all(userId).map((trip) => ({
    ...trip,
    available: trip.status === "open" &&
      Date.parse(trip.scheduledAt) + 2 * HOUR > Date.now() &&
      member(trip.circleId, trip.ownerId),
  }));
}

export function createTrip(userId, input) {
  const circleId = typeof input.circleId === "string" ? input.circleId : "";
  const collectionPoint = typeof input.collectionPoint === "string"
    ? input.collectionPoint.trim().replace(/\s+/g, " ") : "";
  const note = typeof input.note === "string"
    ? input.note.trim().replace(/\s+/g, " ") : "";
  const scheduled = typeof input.scheduledAt === "string" ? Date.parse(input.scheduledAt) : NaN;
  if (collectionPoint.length < 2 || collectionPoint.length > 80 || note.length > 240) {
    return fail("Add a collection point and keep the note under 240 characters.");
  }
  if (!Number.isFinite(scheduled) || scheduled <= Date.now() || scheduled > Date.now() + 7 * 24 * HOUR) {
    return fail("Choose a time in the next 7 days.");
  }
  if (!member(circleId, userId)) return fail("Circle is unavailable.", 404);
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO trips
      (id, circle_id, owner_id, collection_point, note, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(id, circleId, userId, collectionPoint, note, new Date(scheduled).toISOString(), now, now);
  return { ok: true, tripId: id };
}

export function closeTrip(userId, tripId) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const trip = db.prepare("SELECT * FROM trips WHERE id = ? AND owner_id = ?").get(tripId, userId);
    let result;
    if (!trip) result = fail("Trip is unavailable.", 404);
    else if (trip.status !== "open") result = fail("Trip is already closed.", 409);
    else {
      const active = db.prepare(`
        SELECT 1 FROM trip_requests
        JOIN parcel_requests AS request ON request.id = trip_requests.request_id
        WHERE trip_requests.trip_id = ? AND request.status IN ('accepted', 'collected', 'handed_over')
        LIMIT 1
      `).get(tripId);
      if (active) result = fail("Finish or cancel assigned pickups before closing this trip.", 409);
      else {
        db.prepare("UPDATE trips SET status = 'closed', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), tripId);
        result = { ok: true };
      }
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
