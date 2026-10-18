import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

const KEY_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certificates = {};
let expiresAt = 0;

async function certificateFor(kid) {
  if (Date.now() >= expiresAt || !certificates[kid]) {
    const response = await fetch(KEY_URL);
    if (!response.ok) throw new Error("Could not check sign-in certificate.");
    certificates = await response.json();
    const maxAge = Number(response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] || 300);
    expiresAt = Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000;
  }
  return certificates[kid];
}

export async function verifiedIdentity(request, projectId) {
  const match = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/);
  if (!match) return null;
  try {
    const header = decodeProtectedHeader(match[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const certificate = await certificateFor(header.kid);
    if (!certificate) return null;
    const publicKey = await importX509(certificate, "RS256");
    const { payload } = await jwtVerify(match[1], publicKey, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    if (typeof payload.sub !== "string" || !payload.sub ||
        typeof payload.email !== "string" || payload.email_verified !== true ||
        !/^[^\s@]+@vitstudent\.ac\.in$/i.test(payload.email) ||
        typeof payload.auth_time !== "number" || payload.auth_time > Date.now() / 1000 ||
        typeof payload.iat !== "number" || payload.iat > Date.now() / 1000) return null;
    return { id: payload.sub, email: payload.email.toLowerCase() };
  } catch {
    return null;
  }
}
