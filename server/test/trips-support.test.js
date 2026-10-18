import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
const { db, walletFor } = await import("../src/db.js");
const { createCircle, addCircleMember } = await import("../src/network.js");
const { createTrip, listTrips, closeTrip } = await import("../src/trips.js");
const { createRequest, listRequests, transitionRequest } = await import("../src/requests.js");
const { submitTicket, listTickets, supportInbox, supportTicket, setTicketStatus } = await import("../src/support.js");

function student(id) {
  db.prepare(`INSERT INTO users (id, email, student_id, name, verified_at, created_at)
    VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')`)
    .run(id, `${id}@vitstudent.ac.in`, `ID-${id}`, id.toUpperCase());
  db.prepare(`INSERT INTO credit_entries (id, user_id, reason, available_delta, created_at)
    VALUES (?, ?, 'welcome', 2, '2026-01-01')`).run(`welcome-${id}`, id);
}

test("trip pickup stays in its circle and assigns the trip maker", () => {
  for (const id of ["traveller", "requester", "stranger"]) student(id);
  const circleId = createCircle("traveller", "Hostel").circleId;
  db.prepare("INSERT INTO friendships (user_a, user_b, created_at) VALUES (?, ?, '2026-01-01')")
    .run("requester", "traveller");
  addCircleMember("traveller", circleId, "requester");
  const scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(createTrip("stranger", { circleId, collectionPoint: "Gate", scheduledAt }).status, 404);
  const trip = createTrip("traveller", { circleId, collectionPoint: "Main gate", scheduledAt });
  assert.equal(trip.ok, true);
  assert.equal(listTrips("stranger").length, 0);
  assert.equal(listTrips("requester")[0].available, true);
  assert.equal(createRequest("traveller", { tripId: trip.tripId, parcelLabel: "Books" }).status, 403);
  assert.equal(createRequest("stranger", { tripId: trip.tripId, parcelLabel: "Books" }).status, 404);
  const request = createRequest("requester", { tripId: trip.tripId, parcelLabel: "Books" });
  assert.equal(request.ok, true);
  assert.equal(listRequests("requester")[0].status, "accepted");
  assert.equal(listRequests("requester")[0].helperId, "traveller");
  assert.equal(listRequests("requester")[0].collectionPoint, "Main gate");
  assert.equal(listRequests("stranger").length, 0);
  assert.equal(walletFor("requester").reserved, 1);
  assert.equal(closeTrip("traveller", trip.tripId).status, 409);
  assert.equal(transitionRequest("traveller", request.requestId, "collect").ok, true);
  assert.equal(transitionRequest("traveller", request.requestId, "handover").ok, true);
  assert.equal(transitionRequest("requester", request.requestId, "confirm").ok, true);
  assert.equal(walletFor("traveller").earned, 1);
  assert.equal(closeTrip("traveller", trip.tripId).ok, true);
  assert.equal(listTrips("requester")[0].available, false);
  assert.equal(createRequest("requester", { tripId: trip.tripId, parcelLabel: "More books" }).status, 404);
});

test("technical reports are private and never affect parcel or credit records", () => {
  student("reporter");
  student("other-student");
  const before = { ...walletFor("reporter") };
  const requestsBefore = db.prepare("SELECT COUNT(*) AS count FROM parcel_requests").get().count;
  assert.equal(submitTicket("reporter", { category: "parcel", description: "A parcel problem happened." }).status, 400);
  const result = submitTicket("reporter", {
    category: "display",
    description: "The dark mode switch overlaps the title on my phone.",
  });
  assert.equal(result.ok, true);
  assert.equal(listTickets("reporter")[0].status, "received");
  assert.equal(listTickets("other-student").length, 0);
  assert.equal(supportInbox("received")[0].id, result.ticketId);
  assert.equal(supportTicket(result.ticketId).studentEmail, "reporter@vitstudent.ac.in");
  assert.equal(setTicketStatus(result.ticketId, "in_review").ok, true);
  assert.equal(listTickets("reporter")[0].status, "in_review");
  assert.equal(setTicketStatus(result.ticketId, "resolved").ok, true);
  assert.equal(supportInbox("received").length, 0);
  assert.deepEqual({ ...walletFor("reporter") }, before);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM parcel_requests").get().count, requestsBefore);
});
