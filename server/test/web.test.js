import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.NODE_ENV = "production";
const { config } = await import("../src/config.js");
const { serveWeb } = await import("../src/web.js");

test("production web serving stays inside the built app directory", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "parcelmate-web-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  config.webDistPath = root;
  await writeFile(join(root, "index.html"), "<h1>ParcelMate</h1>");
  const response = () => ({
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  });
  const homepage = response();
  assert.equal(await serveWeb("/", homepage), true);
  assert.equal(homepage.status, 200);
  assert.match(homepage.body.toString(), /ParcelMate/);
  assert.match(homepage.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  const verify = response();
  assert.equal(await serveWeb("/verify", verify), true);
  assert.equal(verify.headers["Cache-Control"], "no-store");
  assert.equal(await serveWeb("/api/me", response()), false);
  assert.equal(await serveWeb("/../server/.env", response()), false);
});
