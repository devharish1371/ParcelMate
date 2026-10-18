import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

if (config.dbPath !== ":memory:") mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    student_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    verified_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS login_tokens (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    student_id TEXT,
    name TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON login_tokens(email);
  CREATE TABLE IF NOT EXISTS login_rate_limits (
    email TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
  CREATE TABLE IF NOT EXISTS credit_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT,
    reason TEXT NOT NULL,
    available_delta INTEGER NOT NULL DEFAULT 0,
    reserved_delta INTEGER NOT NULL DEFAULT 0,
    earned_delta INTEGER NOT NULL DEFAULT 0,
    spent_delta INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_entries_user_idx ON credit_entries(user_id);
  CREATE TABLE IF NOT EXISTS friend_invitations (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(sender_id, recipient_id),
    CHECK(sender_id <> recipient_id)
  );
  CREATE INDEX IF NOT EXISTS friend_invitations_recipient_idx
    ON friend_invitations(recipient_id, status);
  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY(user_a, user_b),
    CHECK(user_a < user_b)
  );
  CREATE TABLE IF NOT EXISTS circles (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(owner_id, name)
  );
  CREATE TABLE IF NOT EXISTS circle_members (
    circle_id TEXT NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY(circle_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS circle_members_user_idx ON circle_members(user_id);
  CREATE TABLE IF NOT EXISTS parcel_requests (
    id TEXT PRIMARY KEY,
    circle_id TEXT NOT NULL REFERENCES circles(id),
    requester_id TEXT NOT NULL REFERENCES users(id),
    helper_id TEXT REFERENCES users(id),
    parcel_label TEXT NOT NULL,
    collection_point TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'collected', 'handed_over', 'completed', 'cancelled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (helper_id IS NULL OR helper_id <> requester_id)
  );
  CREATE INDEX IF NOT EXISTS parcel_requests_circle_idx ON parcel_requests(circle_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS request_events (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES parcel_requests(id),
    actor_id TEXT NOT NULL REFERENCES users(id),
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS request_events_request_idx ON request_events(request_id, created_at);
  CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    circle_id TEXT NOT NULL REFERENCES circles(id),
    owner_id TEXT NOT NULL REFERENCES users(id),
    collection_point TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS trips_circle_idx ON trips(circle_id, scheduled_at);
  CREATE TABLE IF NOT EXISTS trip_requests (
    trip_id TEXT NOT NULL REFERENCES trips(id),
    request_id TEXT NOT NULL UNIQUE REFERENCES parcel_requests(id),
    PRIMARY KEY(trip_id, request_id)
  );
  CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('sign_in', 'notifications', 'display', 'other')),
    description TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('received', 'in_review', 'resolved')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON support_tickets(user_id, created_at DESC);
`);

export function walletFor(userId) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(available_delta), 0) AS available,
      COALESCE(SUM(reserved_delta), 0) AS reserved,
      COALESCE(SUM(earned_delta), 0) AS earned,
      COALESCE(SUM(spent_delta), 0) AS spent
    FROM credit_entries WHERE user_id = ?
  `).get(userId);
}
