import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedEmail, externalTestingEnabled } from "../src/auth.js";

test("temporary test access allows only exact verified-token email matches", () => {
  assert.equal(allowedEmail("student@vitstudent.ac.in", undefined), true);
  assert.equal(allowedEmail("student@vitstudent.ac.in.evil", undefined), false);
  assert.equal(allowedEmail("tester@example.com", undefined), false);
  assert.equal(allowedEmail("tester@example.com", "tester@example.com"), true);
  assert.equal(allowedEmail("TESTER@EXAMPLE.COM", "tester@example.com"), true);
  assert.equal(allowedEmail("another@example.com", "tester@example.com"), false);
  assert.equal(externalTestingEnabled(undefined), false);
  assert.equal(externalTestingEnabled("tester@example.com"), true);
});
