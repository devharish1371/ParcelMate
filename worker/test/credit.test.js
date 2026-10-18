import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const plain = (row) => ({ ...row });

test("database triggers grant once, reserve, release, and settle credits atomically", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(schema);
  const timestamp = new Date().toISOString();
  const addUser = db.prepare(`INSERT INTO users
    (id, email, student_id, name, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  addUser.run("requester", "a@vitstudent.ac.in", "24A001", "A Student", timestamp, timestamp);
  addUser.run("helper", "b@vitstudent.ac.in", "24B001", "B Student", timestamp, timestamp);
  assert.equal(db.prepare("SELECT available FROM wallets WHERE user_id = 'requester'").get().available, 2);
  assert.throws(() => addUser.run("requester", "a@vitstudent.ac.in", "24A001", "A Student", timestamp, timestamp));
  assert.equal(db.prepare("SELECT available FROM wallets WHERE user_id = 'requester'").get().available, 2);

  db.prepare("INSERT INTO circles (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run("circle", "requester", "Friends", timestamp);
  db.prepare("INSERT INTO circle_members (circle_id, user_id, added_at) VALUES (?, ?, ?)")
    .run("circle", "requester", timestamp);
  const addRequest = db.prepare(`INSERT INTO parcel_requests
    (id, circle_id, requester_id, helper_id, parcel_label, collection_point, note, status, created_at, updated_at)
    VALUES (?, 'circle', 'requester', NULL, 'Books', 'Gate', '', 'open', ?, ?)`);
  addRequest.run("cancelled", timestamp, timestamp);
  assert.deepEqual(plain(db.prepare("SELECT available, reserved FROM wallets WHERE user_id = 'requester'").get()),
    { available: 1, reserved: 1 });
  db.prepare("UPDATE parcel_requests SET status = 'cancelled' WHERE id = 'cancelled'").run();
  assert.deepEqual(plain(db.prepare("SELECT available, reserved FROM wallets WHERE user_id = 'requester'").get()),
    { available: 2, reserved: 0 });

  addRequest.run("first", timestamp, timestamp);
  addRequest.run("second", timestamp, timestamp);
  assert.throws(() => addRequest.run("third", timestamp, timestamp), /CHECK constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM parcel_requests").get().count, 3);
  db.prepare("UPDATE parcel_requests SET helper_id = 'helper', status = 'handed_over' WHERE id = 'first'").run();
  db.prepare("UPDATE parcel_requests SET status = 'completed' WHERE id = 'first'").run();
  assert.deepEqual(plain(db.prepare("SELECT available, reserved, spent FROM wallets WHERE user_id = 'requester'").get()),
    { available: 0, reserved: 1, spent: 1 });
  assert.deepEqual(plain(db.prepare("SELECT available, earned FROM wallets WHERE user_id = 'helper'").get()),
    { available: 3, earned: 1 });
  db.close();
});
