import { all, cleanText, fail, id, now, result, run } from "./db.js";

const categories = new Set(["sign_in", "notifications", "display", "other"]);

export async function listTickets(db, userId) {
  return result({ tickets: await all(db, `SELECT id, category, description, status,
    created_at AS createdAt, updated_at AS updatedAt FROM support_tickets
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`, userId) });
}

export async function submitTicket(db, userId, input) {
  if (!categories.has(input.category)) return fail("Choose a technical issue type.");
  const description = cleanText(input.description, 20, 1000);
  if (!description) return fail("Describe the app issue in 20 to 1000 characters.");
  const ticketId = id();
  const timestamp = now();
  await run(db, `INSERT INTO support_tickets
    (id, user_id, category, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'received', ?, ?)`,
    ticketId, userId, input.category, description, timestamp, timestamp);
  return result({ ok: true, ticketId });
}
