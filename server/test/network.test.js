import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
const { db } = await import("../src/db.js");
const {
  inviteFriend,
  respondToInvitation,
  createCircle,
  addCircleMember,
  removeCircleMember,
  listNetwork,
} = await import("../src/network.js");

function addUser(id, email, name) {
  db.prepare(`
    INSERT INTO users (id, email, student_id, name, verified_at, created_at)
    VALUES (?, ?, ?, ?, '2026-01-01', '2026-01-01')
  `).run(id, email, `ID-${id}`, name);
}

test("friendship requires recipient approval and circles stay private", () => {
  addUser("a", "a@vitstudent.ac.in", "Arjun");
  addUser("b", "b@vitstudent.ac.in", "Bina");
  addUser("c", "c@vitstudent.ac.in", "Chirag");

  assert.equal(inviteFriend("a", "b@example.com").status, 400);
  assert.equal(inviteFriend("a", "unknown@vitstudent.ac.in").status, 404);
  assert.equal(inviteFriend("a", "b@vitstudent.ac.in").ok, true);
  assert.equal(listNetwork("a").friends.length, 0);
  const invitation = listNetwork("b").invitations[0];
  assert.equal(invitation.senderId, "a");
  assert.equal(respondToInvitation("a", invitation.id, "accept").status, 404);
  assert.equal(respondToInvitation("b", invitation.id, "accept").ok, true);
  assert.equal(listNetwork("a").friends[0].id, "b");

  const circle = createCircle("a", "Hostel Friends");
  assert.equal(circle.ok, true);
  assert.equal(listNetwork("a").circles[0].members.length, 1);
  assert.equal(listNetwork("b").circles.length, 0);
  assert.equal(addCircleMember("c", circle.circleId, "b").status, 404);
  assert.equal(addCircleMember("a", circle.circleId, "c").status, 403);
  assert.equal(addCircleMember("a", circle.circleId, "b").ok, true);
  assert.equal(listNetwork("b").circles[0].members.length, 2);
  assert.equal(listNetwork("c").circles.length, 0);
  assert.equal(removeCircleMember("b", circle.circleId, "a").status, 404);
  assert.equal(removeCircleMember("a", circle.circleId, "b").ok, true);
  assert.equal(listNetwork("b").circles.length, 0);
});
