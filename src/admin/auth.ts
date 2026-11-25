/**
 * Administrator authentication, deliberately separate from customer auth.
 *
 * - Its own table (`admin_users`) and its own cookie (`sq_admin`), so a customer
 *   session can never be promoted to an admin session.
 * - scrypt password hashes (same helper as customer accounts).
 * - Only the SHA-256 hash of the session token is stored; 8 hour lifetime.
 * - Optional TOTP (RFC 6238) implemented on node:crypto, no dependency.
 * - The first account can only be created with ADMIN_SETUP_TOKEN and only while
 *   no admin exists.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "../db.ts";
import { config } from "../config.ts";
import { hashPassword, verifyPassword } from "../auth.ts";

export const ADMIN_COOKIE = "sq_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const now = (): string => new Date().toISOString();

export interface AdminRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: "owner" | "editor";
  totp_secret: string | null;
  totp_enabled: number;
  created_at: string;
  last_login_at: string | null;
}

/* ------------------------------------------------------------------ helpers */

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ------------------------------------------------------------------ accounts */

export function adminCount(): number {
  const row = db.query("SELECT COUNT(*) AS c FROM admin_users").get() as { c: number };
  return row.c;
}

export function createAdmin(input: { email: string; password: string; name: string }): AdminRow {
  const admin: AdminRow = {
    id: randomBytes(16).toString("hex"),
    email: input.email.toLowerCase().trim(),
    password_hash: hashPassword(input.password),
    name: input.name.trim(),
    role: "owner",
    totp_secret: null,
    totp_enabled: 0,
    created_at: now(),
    last_login_at: null,
  };
  db.query(
    `INSERT INTO admin_users (id, email, password_hash, name, role, totp_secret, totp_enabled, created_at, last_login_at)
     VALUES ($id, $e, $h, $n, $r, NULL, 0, $c, NULL)`,
  ).run({ $id: admin.id, $e: admin.email, $h: admin.password_hash, $n: admin.name, $r: admin.role, $c: admin.created_at });
  return admin;
}

export function findAdminByEmail(email: string): AdminRow | null {
  return (db.query("SELECT * FROM admin_users WHERE email = $e").get({ $e: email.toLowerCase().trim() }) as AdminRow | null) ?? null;
}

export function getAdmin(id: string): AdminRow | null {
  return (db.query("SELECT * FROM admin_users WHERE id = $id").get({ $id: id }) as AdminRow | null) ?? null;
}

export function verifyAdminPassword(admin: AdminRow, password: string): boolean {
  return verifyPassword(password, admin.password_hash);
}

// Used for unknown accounts so a failed login always pays the scrypt cost.
const DUMMY_ADMIN_HASH = hashPassword("dummy-admin-password-for-timing-only");
export function verifyDummyAdminPassword(password: string): boolean {
  verifyPassword(password, DUMMY_ADMIN_HASH);
  return false;
}

export function updateAdminPassword(id: string, password: string): void {
  db.query("UPDATE admin_users SET password_hash = $h WHERE id = $id").run({ $h: hashPassword(password), $id: id });
}

export function touchAdminLogin(id: string): void {
  db.query("UPDATE admin_users SET last_login_at = $t WHERE id = $id").run({ $t: now(), $id: id });
}

export function setTotpSecret(id: string, secret: string | null, enabled: boolean): void {
  db.query("UPDATE admin_users SET totp_secret = $s, totp_enabled = $e WHERE id = $id").run({
    $s: secret,
    $e: enabled ? 1 : 0,
    $id: id,
  });
}

/* ------------------------------------------------------------------ sessions */

export function startAdminSession(adminId: string, ip: string): { cookie: string } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();
  db.query(`INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at, ip) VALUES ($h, $a, $e, $c, $i)`).run({
    $h: sha256(token),
    $a: adminId,
    $e: expiresAt,
    $c: now(),
    $i: ip,
  });
  const attrs = [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (config.isProduction || config.appOrigin.startsWith("https://")) attrs.push("Secure");
  return { cookie: attrs.join("; ") };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function currentAdmin(req: Request): AdminRow | null {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const session = db.query("SELECT admin_id, expires_at FROM admin_sessions WHERE token_hash = $h").get({ $h: sha256(token) }) as
    | { admin_id: string; expires_at: string }
    | null;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.query("DELETE FROM admin_sessions WHERE token_hash = $h").run({ $h: sha256(token) });
    return null;
  }
  return getAdmin(session.admin_id);
}

export function endAdminSession(req: Request): string {
  const token = readCookie(req, ADMIN_COOKIE);
  if (token) db.query("DELETE FROM admin_sessions WHERE token_hash = $h").run({ $h: sha256(token) });
  const attrs = [`${ADMIN_COOKIE}=`, "Path=/admin", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (config.isProduction || config.appOrigin.startsWith("https://")) attrs.push("Secure");
  return attrs.join("; ");
}

export function pruneAdminSessions(): void {
  db.query("DELETE FROM admin_sessions WHERE expires_at < $now").run({ $now: now() });
}

export function deleteAdminSessions(adminId: string): void {
  db.query("DELETE FROM admin_sessions WHERE admin_id = $id").run({ $id: adminId });
}

/* --------------------------------------------------------------- setup token */

export function setupTokenConfigured(): boolean {
  const token = (process.env.ADMIN_SETUP_TOKEN ?? "").trim();
  return token.length >= 16;
}

/** Constant-time check of the one-time setup token from the environment. */
export function setupTokenValid(candidate: string): boolean {
  const token = (process.env.ADMIN_SETUP_TOKEN ?? "").trim();
  if (token.length < 16) return false;
  return safeEqual(candidate.trim(), token);
}

/* --------------------------------------------------------------------- TOTP */

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** RFC 6238, 6 digits, 30 second step, HMAC-SHA1. */
export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", Buffer.from(base32Decode(secret))).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Accepts the current step and one step either side to tolerate clock drift. */
export function verifyTotp(secret: string, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const base = Date.now();
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(clean, totpCode(secret, base + drift * 30_000))) return true;
  }
  return false;
}

export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`STOQWISE admin:${email}`);
  const params = new URLSearchParams({ secret, issuer: "STOQWISE", algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}
