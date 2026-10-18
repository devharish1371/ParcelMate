import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { cleanEmail } from "./auth.js";

function fail(error, status = 400) {
  return { error, status };
}

function withTransaction(work) {
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

function friendshipPair(first, second) {
  return first < second ? [first, second] : [second, first];
}

function areFriends(first, second) {
  const [userA, userB] = friendshipPair(first, second);
  return Boolean(db.prepare(
    "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?",
  ).get(userA, userB));
}

export function listNetwork(userId) {
  const friends = db.prepare(`
    SELECT users.id, users.name, users.email FROM friendships
    JOIN users ON users.id = CASE
      WHEN friendships.user_a = ? THEN friendships.user_b
      ELSE friendships.user_a END
    WHERE friendships.user_a = ? OR friendships.user_b = ?
    ORDER BY users.name COLLATE NOCASE
  `).all(userId, userId, userId);

  const invitations = db.prepare(`
    SELECT invitations.id, invitations.status, invitations.created_at AS createdAt,
      sender.id AS senderId, sender.name AS senderName, sender.email AS senderEmail,
      recipient.id AS recipientId, recipient.name AS recipientName
    FROM friend_invitations AS invitations
    JOIN users AS sender ON sender.id = invitations.sender_id
    JOIN users AS recipient ON recipient.id = invitations.recipient_id
    WHERE (invitations.sender_id = ? OR invitations.recipient_id = ?)
      AND invitations.status = 'pending'
    ORDER BY invitations.created_at DESC
  `).all(userId, userId);

  const circles = db.prepare(`
    SELECT circles.id, circles.name, circles.owner_id AS ownerId,
      owners.name AS ownerName
    FROM circles
    JOIN circle_members AS mine ON mine.circle_id = circles.id
    JOIN users AS owners ON owners.id = circles.owner_id
    WHERE mine.user_id = ?
    ORDER BY circles.created_at DESC
  `).all(userId).map((circle) => ({
    ...circle,
    members: db.prepare(`
      SELECT users.id, users.name, users.email FROM circle_members
      JOIN users ON users.id = circle_members.user_id
      WHERE circle_members.circle_id = ?
      ORDER BY users.name COLLATE NOCASE
    `).all(circle.id),
  }));

  return { friends, invitations, circles };
}

export function inviteFriend(userId, emailInput) {
  const email = cleanEmail(emailInput);
  if (!email) return fail("Invite a student with a @vitstudent.ac.in account.");
  const recipient = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!recipient) return fail("This student has not verified a ParcelMate account yet.", 404);
  if (recipient.id === userId) return fail("You cannot invite yourself.");
  if (areFriends(userId, recipient.id)) return fail("You are already friends.", 409);
  const reverse = db.prepare(`
    SELECT id FROM friend_invitations
    WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'
  `).get(recipient.id, userId);
  if (reverse) return fail("This student has already invited you. Accept their invitation instead.", 409);

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO friend_invitations
      (id, sender_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(sender_id, recipient_id) DO UPDATE SET
      status = 'pending', updated_at = excluded.updated_at
  `).run(randomUUID(), userId, recipient.id, now, now);
  return { ok: true };
}

export function respondToInvitation(userId, invitationId, decision) {
  if (!['accept', 'decline'].includes(decision)) return fail("Choose accept or decline.");
  return withTransaction(() => {
    const invitation = db.prepare(`
      SELECT * FROM friend_invitations
      WHERE id = ? AND recipient_id = ? AND status = 'pending'
    `).get(invitationId, userId);
    if (!invitation) return fail("Invitation is unavailable.", 404);
    db.prepare(`
      UPDATE friend_invitations SET status = ?, updated_at = ? WHERE id = ?
    `).run(decision === 'accept' ? 'accepted' : 'declined', new Date().toISOString(), invitationId);
    if (decision === 'accept') {
      const [userA, userB] = friendshipPair(invitation.sender_id, invitation.recipient_id);
      db.prepare(`
        INSERT OR IGNORE INTO friendships (user_a, user_b, created_at)
        VALUES (?, ?, ?)
      `).run(userA, userB, new Date().toISOString());
    }
    return { ok: true };
  });
}

export function createCircle(userId, nameInput) {
  const name = typeof nameInput === 'string' ? nameInput.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 40) return fail("Circle names need 2 to 40 characters.");
  if (db.prepare("SELECT id FROM circles WHERE owner_id = ? AND name = ?").get(userId, name)) {
    return fail("You already have a circle with this name.", 409);
  }
  return withTransaction(() => {
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO circles (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, userId, name, now);
    db.prepare("INSERT INTO circle_members (circle_id, user_id, added_at) VALUES (?, ?, ?)")
      .run(id, userId, now);
    return { ok: true, circleId: id };
  });
}

export function addCircleMember(userId, circleId, friendId) {
  const circle = db.prepare("SELECT owner_id FROM circles WHERE id = ?").get(circleId);
  if (!circle || circle.owner_id !== userId) return fail("Circle is unavailable.", 404);
  if (typeof friendId !== 'string' || !areFriends(userId, friendId)) {
    return fail("Only accepted friends can join your circle.", 403);
  }
  db.prepare("INSERT OR IGNORE INTO circle_members (circle_id, user_id, added_at) VALUES (?, ?, ?)")
    .run(circleId, friendId, new Date().toISOString());
  return { ok: true };
}

export function removeCircleMember(userId, circleId, memberId) {
  const circle = db.prepare("SELECT owner_id FROM circles WHERE id = ?").get(circleId);
  if (!circle || circle.owner_id !== userId) return fail("Circle is unavailable.", 404);
  if (memberId === userId) return fail("The circle owner cannot be removed.");
  const active = db.prepare(`
    SELECT 1 FROM parcel_requests
    WHERE circle_id = ? AND (requester_id = ? OR helper_id = ?)
      AND status IN ('open', 'accepted', 'collected', 'handed_over')
    LIMIT 1
  `).get(circleId, memberId, memberId);
  if (active) return fail("This member has an active request in the circle.", 409);
  const upcomingTrip = db.prepare(`
    SELECT 1 FROM trips WHERE circle_id = ? AND owner_id = ? AND status = 'open'
      AND scheduled_at > ? LIMIT 1
  `).get(circleId, memberId, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  if (upcomingTrip) return fail("This member has an active trip in the circle.", 409);
  const result = db.prepare("DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?")
    .run(circleId, memberId);
  return result.changes ? { ok: true } : fail("Member is not in this circle.", 404);
}
