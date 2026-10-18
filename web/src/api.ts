import { auth } from "./firebase";

const configuredOrigin = import.meta.env.VITE_API_ORIGIN?.replace(/\/$/, "") || "";
export const cloudMode = Boolean(configuredOrigin);

export async function apiFetch(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (cloudMode) {
    const current = auth.currentUser;
    if (current) headers.set("Authorization", `Bearer ${await current.getIdToken()}`);
  }
  return fetch(`${configuredOrigin}${path}`, {
    ...options,
    headers,
    credentials: cloudMode ? "omit" : "same-origin",
  });
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await apiFetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body as T;
}
