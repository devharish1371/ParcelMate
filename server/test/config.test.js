import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.NODE_ENV = "production";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "ParcelMate <test@example.com>";
const { config, validateProductionConfig } = await import("../src/config.js");

test("production startup requires delivery, HTTPS, durable data, and built web files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "parcelmate-config-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const original = { ...config };
  context.after(() => Object.assign(config, original));
  context.after(() => { process.env.NODE_ENV = "test"; });
  config.appOrigin = "http://parcelmate.example";
  config.dbPath = join(root, "data.sqlite");
  config.webDistPath = root;
  assert.throws(() => validateProductionConfig(), /HTTPS origin/);
  config.appOrigin = "https://parcelmate.example";
  config.dbPath = ":memory:";
  assert.throws(() => validateProductionConfig(), /persistent/);
  config.dbPath = join(root, "data.sqlite");
  assert.throws(() => validateProductionConfig(), /Build the web app/);
  await writeFile(join(root, "index.html"), "<h1>ParcelMate</h1>");
  assert.doesNotThrow(() => validateProductionConfig());
});
