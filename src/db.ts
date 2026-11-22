/**
 * Persistence layer on top of bun:sqlite.
 *
 * Design choices worth knowing:
 * - One file database. At this scale (tens of customers, thousands of analyses)
 *   it is faster and simpler than a networked database, and it backs up by
 *   copying one file.
 * - Raw uploaded files are never written to disk. Only the parsed rows and the
 *   computed result are stored, which keeps the data footprint small and makes
 *   deletion complete and provable.
 * - Every read is scoped by user_id. There is no query that returns another
 *   tenant's rows.
 */
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { config, ensureRuntimeDirs } from "./config.ts";
import { migrate } from "./data/migrate.ts";

ensureRuntimeDirs();

export const db = new Database(config.dbPath, { create: true });

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    company       TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id             TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename       TEXT NOT NULL,
    status         TEXT NOT NULL,
    rows           INTEGER NOT NULL DEFAULT 0,
    input_json     TEXT,
    result_json    TEXT,
    narrative_json TEXT,
    error          TEXT,
    created_at     TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_analyses_user
    ON analyses(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT,
    analysis_id TEXT,
    kind        TEXT NOT NULL,
    message     TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS leads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL,
    company    TEXT,
    message    TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

/** Brings any existing 1.x database up to the current schema. Runs once per process. */
export const migration = migrate(db);

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ users */

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  company: string | null;
  created_at: string;
}

export function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
  company: string | null;
}): UserRow {
  const user: UserRow = {
    id: randomUUID(),
    email: input.email.toLowerCase().trim(),
    password_hash: input.passwordHash,
    name: input.name.trim(),
    company: input.company?.trim() || null,
    created_at: now(),
  };
  db.query(
    `INSERT INTO users (id, email, password_hash, name, company, created_at)
     VALUES ($id, $email, $hash, $name, $company, $created)`,
  ).run({
    $id: user.id,
    $email: user.email,
    $hash: user.password_hash,
    $name: user.name,
    $company: user.company,
    $created: user.created_at,
  });
  return user;
}

export function findUserByEmail(email: string): UserRow | null {
  return (
    (db
      .query("SELECT * FROM users WHERE email = $email")
      .get({ $email: email.toLowerCase().trim() }) as UserRow | null) ?? null
  );
}

export function findUserById(id: string): UserRow | null {
  return (
    (db.query("SELECT * FROM users WHERE id = $id").get({ $id: id }) as UserRow | null) ??
    null
  );
}

/* --------------------------------------------------------------- sessions */

export function createSession(userId: string, tokenHash: string, expiresAt: string): void {
  db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
     VALUES ($t, $u, $e, $c)`,
  ).run({ $t: tokenHash, $u: userId, $e: expiresAt, $c: now() });
}

export function findSession(tokenHash: string): { user_id: string; expires_at: string } | null {
  return (
    (db
      .query("SELECT user_id, expires_at FROM sessions WHERE token_hash = $t")
      .get({ $t: tokenHash }) as { user_id: string; expires_at: string } | null) ?? null
  );
}

export function deleteSession(tokenHash: string): void {
  db.query("DELETE FROM sessions WHERE token_hash = $t").run({ $t: tokenHash });
}

export function deleteExpiredSessions(): void {
  db.query("DELETE FROM sessions WHERE expires_at < $now").run({ $now: now() });
}

/* --------------------------------------------------------------- analyses */

export interface AnalysisRow {
  id: string;
  user_id: string;
  filename: string;
  status: "ok" | "failed" | "draft";
  rows: number;
  input_json: string | null;
  result_json: string | null;
  narrative_json: string | null;
  error: string | null;
  created_at: string;
}

export function insertAnalysis(input: {
  userId: string;
  filename: string;
  status: "ok" | "failed" | "draft";
  rows: number;
  inputJson: string | null;
  resultJson: string | null;
  narrativeJson: string | null;
  error: string | null;
}): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO analyses
       (id, user_id, filename, status, rows, input_json, result_json, narrative_json, error, created_at)
     VALUES ($id, $u, $f, $s, $r, $ij, $rj, $nj, $e, $c)`,
  ).run({
    $id: id,
    $u: input.userId,
    $f: input.filename,
    $s: input.status,
    $r: input.rows,
    $ij: input.inputJson,
    $rj: input.resultJson,
    $nj: input.narrativeJson,
    $e: input.error,
    $c: now(),
  });
  return id;
}

export function getAnalysis(userId: string, id: string): AnalysisRow | null {
  return (
    (db
      .query(
        `SELECT id, user_id, filename, status, rows, error, created_at,
                length(result_json) AS result_len
         FROM analyses WHERE id = $id AND user_id = $u`,
      )
      .get({ $id: id, $u: userId }) as unknown as AnalysisRow | null) ?? null
  );
}

/** Full row including JSON blobs. Used by the analysis view and the PDF route. */
export function getAnalysisFull(userId: string, id: string): AnalysisRow | null {
  return (
    (db
      .query("SELECT * FROM analyses WHERE id = $id AND user_id = $u")
      .get({ $id: id, $u: userId }) as AnalysisRow | null) ?? null
  );
}

export function listAnalyses(userId: string, limit = 20) {
  return db
    .query(
      `SELECT id, filename, status, rows, created_at
       FROM analyses WHERE user_id = $u
       ORDER BY created_at DESC LIMIT $l`,
    )
    .all({ $u: userId, $l: limit }) as Array<{
    id: string;
    filename: string;
    status: string;
    rows: number;
    created_at: string;
  }>;
}

export function deleteAnalysis(userId: string, id: string): void {
  db.query("DELETE FROM analyses WHERE id = $id AND user_id = $u").run({
    $id: id,
    $u: userId,
  });
}

export function deleteAllUserData(userId: string): void {
  const tx = db.transaction(() => {
    db.query("DELETE FROM analyses WHERE user_id = $u").run({ $u: userId });
    db.query("DELETE FROM sessions WHERE user_id = $u").run({ $u: userId });
  });
  tx();
}

/** Stores a parsed upload so the mapping step can be resumed after a reload. */
export function insertDraft(input: {
  userId: string;
  filename: string;
  rows: number;
  inputJson: string;
}): string {
  const id = randomUUID();
  db.query(
    `INSERT INTO analyses
       (id, user_id, filename, status, rows, input_json, result_json, narrative_json, error, created_at)
     VALUES ($id, $u, $f, 'draft', $r, $ij, NULL, NULL, NULL, $c)`,
  ).run({
    $id: id,
    $u: input.userId,
    $f: input.filename,
    $r: input.rows,
    $ij: input.inputJson,
    $c: now(),
  });
  return id;
}

export function completeAnalysis(input: {
  id: string;
  userId: string;
  resultJson: string;
  narrativeJson: string;
  rows: number;
}): void {
  db.query(
    `UPDATE analyses
     SET status = 'ok', result_json = $r, narrative_json = $n, error = NULL, rows = $rows
     WHERE id = $id AND user_id = $u`,
  ).run({
    $r: input.resultJson,
    $n: input.narrativeJson,
    $rows: input.rows,
    $id: input.id,
    $u: input.userId,
  });
}

/** Drafts that were never completed would otherwise keep customer data forever. */
export function deleteStaleDrafts(maxAgeHours = 24): number {
  const cutoff = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();
  const result = db
    .query("DELETE FROM analyses WHERE status = 'draft' AND created_at < $c")
    .run({ $c: cutoff });
  return result.changes ?? 0;
}

/* ----------------------------------------------------------------- events */

export function logEvent(input: {
  userId?: string | null;
  analysisId?: string | null;
  kind: string;
  message: string;
}): void {
  db.query(
    `INSERT INTO events (user_id, analysis_id, kind, message, created_at)
     VALUES ($u, $a, $k, $m, $c)`,
  ).run({
    $u: input.userId ?? null,
    $a: input.analysisId ?? null,
    $k: input.kind,
    $m: input.message,
    $c: now(),
  });
}

export function recentEvents(userId: string, limit = 20) {
  return db
    .query(
      `SELECT kind, message, created_at FROM events
       WHERE user_id = $u ORDER BY id DESC LIMIT $l`,
    )
    .all({ $u: userId, $l: limit }) as Array<{
    kind: string;
    message: string;
    created_at: string;
  }>;
}

/* ------------------------------------------------------------------ leads */

export function createLead(input: {
  name: string;
  email: string;
  company: string;
  message: string;
}): void {
  db.query(
    `INSERT INTO leads (name, email, company, message, created_at)
     VALUES ($n, $e, $c, $m, $t)`,
  ).run({
    $n: input.name,
    $e: input.email,
    $c: input.company,
    $m: input.message,
    $t: now(),
  });
}

export function countLeads(): number {
  const row = db.query("SELECT COUNT(*) AS c FROM leads").get() as { c: number };
  return row.c;
}
