import { all, cleanText, fail, first, now, result, run } from "./db.js";

export async function profile(db, identity) {
  const row = await first(db, `
    SELECT users.id, users.email, users.student_id AS studentId, users.name,
      wallets.available, wallets.reserved, wallets.earned, wallets.spent
    FROM users JOIN wallets ON wallets.user_id = users.id
    WHERE users.id = ? AND users.email = ?
  `, identity.id, identity.email);
  if (!row) return fail("Finish your student profile.", 404);
  const { available, reserved, earned, spent, ...user } = row;
  return result({ user: { ...user, wallet: { available, reserved, earned, spent } } });
}

export async function createProfile(db, identity, input) {
  const name = cleanText(input.name, 2, 80);
  const studentId = typeof input.studentId === "string" ? input.studentId.trim().toUpperCase() : "";
  if (!name || !/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(studentId)) {
    return fail("Enter your name and a valid student ID.");
  }
  const existing = await first(db, "SELECT id FROM users WHERE id = ? OR email = ?", identity.id, identity.email);
  if (existing) return profile(db, identity);
  try {
    const timestamp = now();
    await run(db, `INSERT INTO users (id, email, student_id, name, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, identity.id, identity.email, studentId, name, timestamp, timestamp);
    return profile(db, identity);
  } catch (error) {
    if (/UNIQUE constraint failed/.test(String(error))) return fail("This student ID is already registered.", 409);
    throw error;
  }
}

export async function walletEntries(db, userId) {
  return result({ entries: await all(db, `
    SELECT reason, available_delta AS availableDelta, reserved_delta AS reservedDelta,
      earned_delta AS earnedDelta, spent_delta AS spentDelta, created_at AS createdAt
    FROM credit_entries WHERE user_id = ? ORDER BY created_at DESC LIMIT 100
  `, userId) });
}
