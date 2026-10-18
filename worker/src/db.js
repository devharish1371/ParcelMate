export const first = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
export async function all(db, sql, ...args) {
  return (await db.prepare(sql).bind(...args).all()).results;
}
export const run = (db, sql, ...args) => db.prepare(sql).bind(...args).run();
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();

export function cleanText(value, min, max) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null;
}

export async function member(db, circleId, userId) {
  return Boolean(await first(db,
    "SELECT 1 FROM circle_members WHERE circle_id = ? AND user_id = ?", circleId, userId));
}

export async function wallet(db, userId) {
  return await first(db, "SELECT available, reserved, earned, spent FROM wallets WHERE user_id = ?", userId);
}

export function result(body, status = 200) { return { body, status }; }
export function fail(error, status = 400) { return result({ error }, status); }
