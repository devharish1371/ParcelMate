import { createHash, randomBytes, randomUUID } from "node:crypto";
import { config, hasEmailDelivery } from "./config.js";
import { db, walletFor } from "./db.js";

const LOGIN_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 60 * 1000;
const MAX_LOGIN_LINKS_PER_HOUR = 5;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function cleanEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email.endsWith(`@${config.collegeDomain}`) ? email : null;
}

function cleanStudentId(value) {
  if (typeof value !== "string") return null;
  const studentId = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9-]{2,31}$/.test(studentId) ? studentId : null;
}

function cleanName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 80 ? name : null;
}

export async function startLogin(input) {
  const email = cleanEmail(input.email);
  if (!email) return { error: `Use your @${config.collegeDomain} email address.`, status: 400 };

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  const studentId = existing ? null : cleanStudentId(input.studentId);
  const name = existing ? null : cleanName(input.name);
  if (!existing && (!studentId || !name)) {
    return { error: "Enter your name and a valid student ID to sign up.", status: 400 };
  }
  if (!existing && db.prepare("SELECT id FROM users WHERE student_id = ?").get(studentId)) {
    return { error: "This student ID is already registered.", status: 409 };
  }

  const now = Date.now();
  db.prepare(`
    INSERT INTO login_rate_limits (email, window_start, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(email) DO UPDATE SET
      window_start = CASE WHEN window_start <= ? THEN excluded.window_start ELSE window_start END,
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END
  `).run(email, now, now - LOGIN_WINDOW_MS, now - LOGIN_WINDOW_MS);
  const attempts = db.prepare("SELECT attempts FROM login_rate_limits WHERE email = ?").get(email).attempts;
  if (attempts > MAX_LOGIN_LINKS_PER_HOUR) {
    return { error: "Too many sign-in links requested. Try again in an hour.", status: 429 };
  }

  const token = randomBytes(32).toString("base64url");
  const url = new URL("/verify", config.appOrigin);
  url.searchParams.set("token", token);
  db.prepare("DELETE FROM login_tokens WHERE email = ? OR expires_at < ?").run(email, now);
  db.prepare(`
    INSERT INTO login_tokens (token_hash, email, student_id, name, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(hashToken(token), email, studentId, name, now + LOGIN_TTL_MS, now);

  if (hasEmailDelivery) {
    try {
      const delivery = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.emailFrom,
          to: [email],
          subject: "Sign in to ParcelMate",
          text: `Open this link to sign in to ParcelMate. It expires in 15 minutes.\n\n${url}\n\nIf you did not request this link, you can ignore this email.`,
        }),
      });
      if (!delivery.ok) throw new Error("Email delivery failed");
    } catch {
      db.prepare("DELETE FROM login_tokens WHERE token_hash = ?").run(hashToken(token));
      return { error: "Could not send the verification email. Try again later.", status: 503 };
    }
  }

  return {
    ok: true,
    message: hasEmailDelivery
      ? "Check your college email for a sign-in link."
      : "Local development mode: open the verification link below.",
    // Local-only link makes development possible before email delivery is configured.
    ...(process.env.NODE_ENV !== "production" && !hasEmailDelivery
      ? { developmentVerificationUrl: url.toString() }
      : {}),
  };
}

function verifyTransaction(tokenHash, now) {
  db.exec("BEGIN IMMEDIATE");
  try {
  const login = db.prepare("SELECT * FROM login_tokens WHERE token_hash = ?").get(tokenHash);
  if (!login || login.expires_at <= now || !cleanEmail(login.email)) {
    db.exec("ROLLBACK");
    return null;
  }
  db.prepare("DELETE FROM login_tokens WHERE token_hash = ?").run(tokenHash);

  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(login.email);
  if (user && !cleanEmail(user.email)) {
    db.exec("ROLLBACK");
    return null;
  }
  if (!user) {
    if (!login.student_id || !login.name ||
        db.prepare("SELECT id FROM users WHERE student_id = ?").get(login.student_id)) {
      db.exec("ROLLBACK");
      return null;
    }
    const userId = randomUUID();
    const createdAt = new Date(now).toISOString();
    db.prepare(`
      INSERT INTO users (id, email, student_id, name, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, login.email, login.student_id, login.name, createdAt, createdAt);
    db.prepare(`
      INSERT INTO credit_entries
        (id, user_id, reason, available_delta, created_at)
      VALUES (?, ?, 'welcome', 2, ?)
    `).run(randomUUID(), userId, createdAt);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  }

  const sessionToken = randomBytes(32).toString("base64url");
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(hashToken(sessionToken), user.id, now + SESSION_TTL_MS, now);
  db.exec("COMMIT");
  return { sessionToken, user };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function verifyLogin(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  return verifyTransaction(hashToken(token), Date.now());
}

export function sessionFromRequest(request) {
  const match = request.headers.cookie?.match(/(?:^|;\s*)parcelmate_session=([^;]+)/);
  if (!match) return null;
  const session = db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(match[1]), Date.now());
  return session && cleanEmail(session.email) ? session : null;
}

export function logout(request) {
  const match = request.headers.cookie?.match(/(?:^|;\s*)parcelmate_session=([^;]+)/);
  if (match) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(match[1]));
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    studentId: user.student_id,
    name: user.name,
    wallet: walletFor(user.id),
  };
}
