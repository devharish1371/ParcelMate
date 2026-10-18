import { randomUUID } from "node:crypto";
import { db } from "./db.js";

const categories = new Set(["sign_in", "notifications", "display", "other"]);

export function listTickets(userId) {
  return db.prepare(`
    SELECT id, category, description, status, created_at AS createdAt
    FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC
  `).all(userId);
}

export function submitTicket(userId, input) {
  const category = typeof input.category === "string" ? input.category : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!categories.has(category) || description.length < 20 || description.length > 1000) {
    return { error: "Choose a technical category and describe the issue in 20 to 1000 characters.", status: 400 };
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO support_tickets (id, user_id, category, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'received', ?, ?)
  `).run(id, userId, category, description, now, now);
  return { ok: true, ticketId: id };
}

// Local operator functions. They are intentionally absent from the HTTP API.
export function supportInbox(status = "received") {
  if (!["received", "in_review", "resolved", "all"].includes(status)) {
    return { error: "Choose received, in_review, resolved, or all." };
  }
  const query = `
    SELECT tickets.id, tickets.category, tickets.status,
      tickets.created_at AS createdAt, users.email AS studentEmail
    FROM support_tickets AS tickets
    JOIN users ON users.id = tickets.user_id
    ${status === "all" ? "" : "WHERE tickets.status = ?"}
    ORDER BY tickets.created_at DESC
  `;
  return status === "all" ? db.prepare(query).all() : db.prepare(query).all(status);
}

export function supportTicket(id) {
  return db.prepare(`
    SELECT tickets.id, tickets.category, tickets.description, tickets.status,
      tickets.created_at AS createdAt, tickets.updated_at AS updatedAt,
      users.email AS studentEmail
    FROM support_tickets AS tickets
    JOIN users ON users.id = tickets.user_id
    WHERE tickets.id = ?
  `).get(id) || null;
}

export function setTicketStatus(id, status) {
  if (!["in_review", "resolved"].includes(status)) {
    return { error: "Status must be in_review or resolved." };
  }
  const result = db.prepare("UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);
  return result.changes ? { ok: true } : { error: "Ticket not found." };
}
