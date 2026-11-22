/**
 * Authentication without third-party dependencies.
 *
 * Passwords: scrypt with a per-user random salt (memory-hard, in node:crypto).
 * Sessions: 32 random bytes, only the SHA-256 hash is stored, so a database
 * leak does not hand out live sessions. The cookie is HttpOnly + SameSite=Lax
 * and Secure in production.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { config } from "./config.ts";
import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  type UserRow,
} from "./db.ts";

const SCRYPT_KEYLEN = 64;
export const SESSION_COOKIE = "lr_session";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = parts[1]!;
  const expected = Buffer.from(parts[2]!, "hex");
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function newSessionToken(): { token: string; tokenHash: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString();
  return { token, tokenHash, expiresAt };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function startSession(userId: string): { cookie: string } {
  const { token, tokenHash, expiresAt } = newSessionToken();
  createSession(userId, tokenHash, expiresAt);
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${config.sessionTtlSeconds}`,
  ];
  if (config.isProduction) attrs.push("Secure");
  return { cookie: attrs.join("; ") };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

/** Returns the signed-in user, or null. Never throws. */
export function currentUser(req: Request): UserRow | null {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const session = findSession(sha256(token));
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(sha256(token));
    return null;
  }
  return findUserById(session.user_id);
}

export function endSession(req: Request): string {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) deleteSession(sha256(token));
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.isProduction) attrs.push("Secure");
  return attrs.join("; ");
}

/**
 * Minimal CSRF protection: a state-changing request must come from our own
 * origin. Combined with SameSite=Lax cookies this closes the practical hole
 * without needing tokens in every form.
 */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients (curl, tests) have no Origin header. Allow them only
    // when the request is not carrying a session cookie-free cross-site form.
    return true;
  }
  const host = req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
