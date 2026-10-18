import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
const { startLogin, verifyLogin, publicUser, sessionFromRequest } = await import("../src/auth.js");
const { db } = await import("../src/db.js");

test("college verification grants starting credits exactly once", async () => {
  const first = await startLogin({
    email: "arjun@vitstudent.ac.in",
    studentId: "23BCE0001",
    name: "Arjun Joshi",
  });
  assert.equal(first.ok, true);
  const token = new URL(first.developmentVerificationUrl).searchParams.get("token");
  const verified = verifyLogin(token);
  assert.ok(verified);
  assert.equal(publicUser(verified.user).wallet.available, 2);
  assert.equal(verifyLogin(token), null, "a verification link is single use");

  const second = await startLogin({ email: "arjun@vitstudent.ac.in" });
  const nextToken = new URL(second.developmentVerificationUrl).searchParams.get("token");
  const signedInAgain = verifyLogin(nextToken);
  assert.equal(publicUser(signedInAgain.user).wallet.available, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM credit_entries WHERE reason = 'welcome'").get().count, 1);
});

test("only the college domain is eligible", async () => {
  const result = await startLogin({
    email: "student@example.com",
    studentId: "23BCE0002",
    name: "Outside Student",
  });
  assert.equal(result.status, 400);
  const subdomain = await startLogin({
    email: "student@sub.vitstudent.ac.in",
    studentId: "23BCE0003",
    name: "Subdomain Student",
  });
  assert.equal(subdomain.status, 400);
  const lookalike = await startLogin({
    email: "student@fakevitstudent.ac.in",
    studentId: "23BCE0004",
    name: "Lookalike Student",
  });
  assert.equal(lookalike.status, 400);
});

test("a student ID cannot open a second account", async () => {
  const result = await startLogin({
    email: "second@vitstudent.ac.in",
    studentId: "23BCE0001",
    name: "Second Student",
  });
  assert.equal(result.status, 409);
});

test("a session for any other email domain is rejected", async () => {
  const { createHash } = await import("node:crypto");
  const fakeToken = "a".repeat(43);
  const hash = createHash("sha256").update(fakeToken).digest("hex");
  db.prepare(`
    INSERT INTO users (id, email, student_id, name, verified_at, created_at)
    VALUES ('outside', 'outside@example.com', 'OUTSIDE1', 'Outside', '2026-01-01', '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
    VALUES (?, 'outside', ?, ?)
  `).run(hash, Date.now() + 60_000, Date.now());
  assert.equal(sessionFromRequest({ headers: { cookie: `parcelmate_session=${fakeToken}` } }), null);
});

test("sign-in links are rate limited per college email", async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await startLogin({
      email: "limited@vitstudent.ac.in", studentId: "23BCE9900", name: "Limited Student",
    });
    assert.equal(result.ok, true);
  }
  const denied = await startLogin({
    email: "limited@vitstudent.ac.in", studentId: "23BCE9900", name: "Limited Student",
  });
  assert.equal(denied.status, 429);
});
