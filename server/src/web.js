import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { config } from "./config.js";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
};

export async function serveWeb(path, response) {
  if (process.env.NODE_ENV !== "production") return false;
  if (path.startsWith("/api/")) return false;
  const relative = path === "/" || path === "/verify" ? "index.html" : path.slice(1);
  const file = resolve(config.webDistPath, relative);
  if (file !== config.webDistPath && !file.startsWith(`${config.webDistPath}${sep}`)) return false;
  try {
    const content = await readFile(file);
    const extension = extname(file);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Cache-Control": extension === ".html" ? "no-store" : "public, max-age=86400",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    });
    response.end(content);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return false;
    throw error;
  }
}
