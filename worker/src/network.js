import { all, cleanText, fail, first, id, member, now, result, run } from "./db.js";

function pair(a, b) { return a < b ? [a, b] : [b, a]; }

async function friends(db, a, b) {
  const [x, y] = pair(a, b);
  return Boolean(await first(db, "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?", x, y));
}

export async function listNetwork(db, userId) {
  const friendList = await all(db, `
    SELECT users.id, users.name, users.email FROM friendships
    JOIN users ON users.id = CASE WHEN friendships.user_a = ? THEN friendships.user_b ELSE friendships.user_a END
    WHERE friendships.user_a = ? OR friendships.user_b = ? ORDER BY users.name COLLATE NOCASE
  `, userId, userId, userId);
  const invitations = await all(db, `
    SELECT i.id, i.status, i.created_at AS createdAt,
      sender.id AS senderId, sender.name AS senderName, sender.email AS senderEmail,
      recipient.id AS recipientId, recipient.name AS recipientName
    FROM friend_invitations i
    JOIN users sender ON sender.id = i.sender_id
    JOIN users recipient ON recipient.id = i.recipient_id
    WHERE (i.sender_id = ? OR i.recipient_id = ?) AND i.status = 'pending'
    ORDER BY i.created_at DESC
  `, userId, userId);
  const circles = await all(db, `
    SELECT circles.id, circles.name, circles.owner_id AS ownerId, owners.name AS ownerName
    FROM circles JOIN circle_members mine ON mine.circle_id = circles.id
      JOIN users owners ON owners.id = circles.owner_id
    WHERE mine.user_id = ? ORDER BY circles.created_at DESC
  `, userId);
  for (const circle of circles) {
    circle.members = await all(db, `
      SELECT users.id, users.name, users.email FROM circle_members
      JOIN users ON users.id = circle_members.user_id
      WHERE circle_members.circle_id = ? ORDER BY users.name COLLATE NOCASE
    `, circle.id);
  }
  return result({ friends: friendList, invitations, circles });
}

export async function inviteFriend(db, userId, input) {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@vitstudent\.ac\.in$/.test(email)) return fail("Invite a student with a @vitstudent.ac.in account.");
  const recipient = await first(db, "SELECT id FROM users WHERE email = ?", email);
  if (!recipient) return fail("This student has not verified a ParcelMate account yet.", 404);
  if (recipient.id === userId) return fail("You cannot invite yourself.");
  if (await friends(db, userId, recipient.id)) return fail("You are already friends.", 409);
  if (await first(db, `SELECT id FROM friend_invitations
    WHERE sender_id = ? AND recipient_id = ? AND status = 'pending'`, recipient.id, userId)) {
    return fail("This student has already invited you. Accept their invitation instead.", 409);
  }
  const timestamp = now();
  await run(db, `INSERT INTO friend_invitations
    (id, sender_id, recipient_id, status, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(sender_id, recipient_id) DO UPDATE SET status = 'pending', updated_at = excluded.updated_at`,
    id(), userId, recipient.id, timestamp, timestamp);
  return result({ ok: true });
}

export async function respondToInvitation(db, userId, invitationId, decision) {
  if (!["accept", "decline"].includes(decision)) return fail("Choose accept or decline.");
  const invitation = await first(db, `SELECT * FROM friend_invitations
    WHERE id = ? AND recipient_id = ? AND status = 'pending'`, invitationId, userId);
  if (!invitation) return fail("Invitation is unavailable.", 404);
  const outcome = await run(db, `UPDATE friend_invitations SET status = ?, updated_at = ?
    WHERE id = ? AND recipient_id = ? AND status = 'pending'`,
    decision === "accept" ? "accepted" : "declined", now(), invitationId, userId);
  if (outcome.meta.changes < 1) return fail("Invitation is unavailable.", 404);
  return result({ ok: true });
}

export async function createCircle(db, userId, input) {
  const name = cleanText(input.name, 2, 40);
  if (!name) return fail("Circle names need 2 to 40 characters.");
  const circleId = id();
  const timestamp = now();
  try {
    await db.batch([
      db.prepare("INSERT INTO circles (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)")
        .bind(circleId, userId, name, timestamp),
      db.prepare("INSERT INTO circle_members (circle_id, user_id, added_at) VALUES (?, ?, ?)")
        .bind(circleId, userId, timestamp),
    ]);
    return result({ ok: true, circleId });
  } catch (error) {
    if (/UNIQUE constraint failed/.test(String(error))) return fail("You already have a circle with this name.", 409);
    throw error;
  }
}

export async function addCircleMember(db, userId, circleId, friendId) {
  const circle = await first(db, "SELECT owner_id FROM circles WHERE id = ?", circleId);
  if (!circle || circle.owner_id !== userId) return fail("Circle is unavailable.", 404);
  if (typeof friendId !== "string" || !await friends(db, userId, friendId)) {
    return fail("Only accepted friends can join your circle.", 403);
  }
  await run(db, "INSERT OR IGNORE INTO circle_members (circle_id, user_id, added_at) VALUES (?, ?, ?)",
    circleId, friendId, now());
  return result({ ok: true });
}

export async function removeCircleMember(db, userId, circleId, memberId) {
  const circle = await first(db, "SELECT owner_id FROM circles WHERE id = ?", circleId);
  if (!circle || circle.owner_id !== userId) return fail("Circle is unavailable.", 404);
  if (memberId === userId) return fail("The circle owner cannot be removed.");
  const active = await first(db, `SELECT 1 FROM parcel_requests
    WHERE circle_id = ? AND (requester_id = ? OR helper_id = ?)
      AND status IN ('open', 'accepted', 'collected', 'handed_over') LIMIT 1`,
    circleId, memberId, memberId);
  if (active) return fail("This member has an active request in the circle.", 409);
  const trip = await first(db, `SELECT 1 FROM trips WHERE circle_id = ? AND owner_id = ?
    AND status = 'open' AND scheduled_at > ? LIMIT 1`,
    circleId, memberId, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  if (trip) return fail("This member has an active trip in the circle.", 409);
  const deleted = await run(db, `DELETE FROM circle_members WHERE circle_id = ? AND user_id = ?
    AND NOT EXISTS (SELECT 1 FROM parcel_requests WHERE circle_id = ?
      AND (requester_id = ? OR helper_id = ?)
      AND status IN ('open', 'accepted', 'collected', 'handed_over'))
    AND NOT EXISTS (SELECT 1 FROM trips WHERE circle_id = ? AND owner_id = ?
      AND status = 'open' AND scheduled_at > ?)`,
    circleId, memberId, circleId, memberId, memberId, circleId, memberId,
    new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
  return deleted.meta.changes ? result({ ok: true }) : fail("Member is not in this circle.", 404);
}
