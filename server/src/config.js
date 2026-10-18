import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectRoot = resolve(serverRoot, "..");
const envPath = resolve(serverRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const config = {
  port: Number(process.env.PORT || 3001),
  host: process.env.HOST || "127.0.0.1",
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:5173",
  collegeDomain: "vitstudent.ac.in",
  dbPath: process.env.DB_PATH === ":memory:"
    ? ":memory:"
    : resolve(serverRoot, process.env.DB_PATH || "./data/parcelmate.sqlite"),
  resendApiKey: process.env.RESEND_API_KEY || "",
  emailFrom: process.env.EMAIL_FROM || "",
  webDistPath: resolve(projectRoot, "web/dist"),
};

export const hasEmailDelivery = Boolean(config.resendApiKey && config.emailFrom);

export function validateProductionConfig() {
  if (process.env.NODE_ENV !== "production") return;
  if (!hasEmailDelivery) throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production.");
  let origin;
  try {
    origin = new URL(config.appOrigin);
  } catch {
    throw new Error("APP_ORIGIN must be a valid HTTPS origin in production.");
  }
  if (origin.protocol !== "https:" || origin.origin !== config.appOrigin) {
    throw new Error("APP_ORIGIN must be a bare HTTPS origin in production.");
  }
  if (config.dbPath === ":memory:") throw new Error("DB_PATH must be persistent in production.");
  if (!existsSync(resolve(config.webDistPath, "index.html"))) {
    throw new Error("Build the web app with npm run build before production startup.");
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
}
