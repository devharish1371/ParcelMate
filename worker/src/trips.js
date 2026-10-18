import { all, cleanText, fail, first, id, member, now, result, run } from "./db.js";

const HOUR = 60 * 60 * 1000;

export async function listTrips(db, userId) {
  const trips = await all(db, `
    SELECT trips.id, trips.circle_id AS circleId, circles.name AS circleName,
      trips.owner_id AS ownerId, users.name AS ownerName,
      trips.collection_point AS collectionPoint, trips.note,
      trips.scheduled_at AS scheduledAt, trips.status,
      trips.created_at AS createdAt,
      (SELECT COUNT(*) FROM trip_requests
        JOIN parcel_requests ON parcel_requests.id = trip_requests.request_id
        WHERE trip_requests.trip_id = trips.id AND parcel_requests.status <> 'cancelled') AS requestCount
    FROM trips JOIN circle_members mine ON mine.circle_id = trips.circle_id
      JOIN circles ON circles.id = trips.circle_id
      JOIN users ON users.id = trips.owner_id
    WHERE mine.user_id = ? ORDER BY trips.scheduled_at DESC LIMIT 50
  `, userId);
  for (const trip of trips) {
    trip.available = trip.status === "open" &&
      Date.parse(trip.scheduledAt) + 2 * HOUR > Date.now() &&
      await member(db, trip.circleId, trip.ownerId);
  }
  return result({ trips });
}

export async function createTrip(db, userId, input) {
  const circleId = typeof input.circleId === "string" ? input.circleId : "";
  const collectionPoint = cleanText(input.collectionPoint, 2, 80);
  const note = input.note === undefined || input.note === "" ? "" : cleanText(input.note, 0, 240);
  const scheduled = typeof input.scheduledAt === "string" ? Date.parse(input.scheduledAt) : NaN;
  if (!collectionPoint || note === null) return fail("Add a collection point and keep the note under 240 characters.");
  if (!Number.isFinite(scheduled) || scheduled <= Date.now() || scheduled > Date.now() + 7 * 24 * HOUR) {
    return fail("Choose a time in the next 7 days.");
  }
  if (!await member(db, circleId, userId)) return fail("Circle is unavailable.", 404);
  const tripId = id();
  const timestamp = now();
  await run(db, `INSERT INTO trips
    (id, circle_id, owner_id, collection_point, note, scheduled_at, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    tripId, circleId, userId, collectionPoint, note, new Date(scheduled).toISOString(), timestamp, timestamp);
  return result({ ok: true, tripId });
}

export async function closeTrip(db, userId, tripId) {
  const trip = await first(db, "SELECT owner_id FROM trips WHERE id = ?", tripId);
  if (!trip || trip.owner_id !== userId) return fail("Trip is unavailable.", 404);
  const outcome = await run(db, `UPDATE trips SET status = 'closed', updated_at = ?
    WHERE id = ? AND owner_id = ? AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM trip_requests tr
        JOIN parcel_requests r ON r.id = tr.request_id
        WHERE tr.trip_id = trips.id AND r.status IN ('open', 'accepted', 'collected', 'handed_over'))`,
    now(), tripId, userId);
  return outcome.meta.changes === 1 ? result({ ok: true }) : fail("A trip with active pickups cannot be closed.", 409);
}
