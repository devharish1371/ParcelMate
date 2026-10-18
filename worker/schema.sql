CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  earned INTEGER NOT NULL DEFAULT 0 CHECK (earned >= 0),
  spent INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0)
);
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
CREATE INDEX IF NOT EXISTS credit_entries_user_idx ON credit_entries(user_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS credit_entries_apply AFTER INSERT ON credit_entries BEGIN
  UPDATE wallets SET
    available = available + NEW.available_delta,
    reserved = reserved + NEW.reserved_delta,
    earned = earned + NEW.earned_delta,
    spent = spent + NEW.spent_delta
  WHERE user_id = NEW.user_id;
END;
CREATE TRIGGER IF NOT EXISTS users_welcome AFTER INSERT ON users BEGIN
  INSERT INTO wallets (user_id) VALUES (NEW.id);
  INSERT INTO credit_entries (id, user_id, reason, available_delta, created_at)
    VALUES (lower(hex(randomblob(16))), NEW.id, 'welcome', 2, NEW.created_at);
END;

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
CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_a, user_b),
  CHECK(user_a < user_b)
);
CREATE TRIGGER IF NOT EXISTS invitation_accept_friend AFTER UPDATE OF status ON friend_invitations
WHEN NEW.status = 'accepted' AND OLD.status = 'pending' BEGIN
  INSERT OR IGNORE INTO friendships (user_a, user_b, created_at)
    VALUES (min(NEW.sender_id, NEW.recipient_id), max(NEW.sender_id, NEW.recipient_id), NEW.updated_at);
END;
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
CREATE TRIGGER IF NOT EXISTS request_reserve AFTER INSERT ON parcel_requests BEGIN
  INSERT INTO credit_entries
    (id, user_id, request_id, reason, available_delta, reserved_delta, created_at)
    VALUES (lower(hex(randomblob(16))), NEW.requester_id, NEW.id, 'request_reserved', -1, 1, NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS request_cancel_credit AFTER UPDATE OF status ON parcel_requests
WHEN NEW.status = 'cancelled' AND OLD.status IN ('open', 'accepted') BEGIN
  INSERT INTO credit_entries
    (id, user_id, request_id, reason, available_delta, reserved_delta, created_at)
    VALUES (lower(hex(randomblob(16))), NEW.requester_id, NEW.id, 'request_released', 1, -1, NEW.updated_at);
END;
CREATE TRIGGER IF NOT EXISTS request_complete_credit AFTER UPDATE OF status ON parcel_requests
WHEN NEW.status = 'completed' AND OLD.status = 'handed_over' BEGIN
  INSERT INTO credit_entries
    (id, user_id, request_id, reason, reserved_delta, spent_delta, created_at)
    VALUES (lower(hex(randomblob(16))), NEW.requester_id, NEW.id, 'request_spent', -1, 1, NEW.updated_at);
  INSERT INTO credit_entries
    (id, user_id, request_id, reason, available_delta, earned_delta, created_at)
    VALUES (lower(hex(randomblob(16))), NEW.helper_id, NEW.id, 'help_earned', 1, 1, NEW.updated_at);
END;
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
