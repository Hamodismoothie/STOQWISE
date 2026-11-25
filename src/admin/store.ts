/**
 * Content store for the administration system.
 *
 * Two layers per value: a draft and a published version. The public site only
 * reads published values; the admin preview can read drafts. Publishing copies
 * every draft into the published column inside one transaction and writes a
 * version snapshot, so history is never overwritten.
 *
 * Values are resolved per locale. An empty string means "no override": the
 * renderer then falls back to the copy that ships with the code.
 */
import { randomUUID } from "node:crypto";
import { db } from "../db.ts";
import { ALL_FIELDS, type FieldDef, type FieldScope } from "./fields.ts";

export type ContentMode = "published" | "draft";

const now = (): string => new Date().toISOString();

interface FieldRow {
  scope: string;
  key: string;
  locale: string;
  draft: string | null;
  published: string | null;
  updated_at: string;
  updated_by: string | null;
}

/* --------------------------------------------------------------- memo cache */

interface CacheEntry {
  at: number;
  values: Record<string, string>;
}

const cache = new Map<string, CacheEntry>();
const CACHE_MS = 1500;

export function invalidateContentCache(): void {
  cache.clear();
}

/** All values for one scope and locale, as a flat key → text map. */
export function fieldValues(scope: FieldScope, locale: string, mode: ContentMode = "published"): Record<string, string> {
  const cacheKey = `${scope}:${locale}:${mode}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.values;

  const column = mode === "draft" ? "draft" : "published";
  const rows = db
    .query(`SELECT key, ${column} AS value FROM cms_fields WHERE scope = $s AND locale = $l AND ${column} IS NOT NULL`)
    .all({ $s: scope, $l: locale }) as Array<{ key: string; value: string }>;

  const values: Record<string, string> = {};
  for (const row of rows) if (row.value !== "") values[row.key] = row.value;

  // Company details, providers, retention periods and payment terms are facts,
  // not copy: the Swedish values fill the English document too. Site copy stays
  // per language so a Swedish edit never replaces English marketing text.
  if (scope === "legal" && locale !== "sv") {
    for (const [key, value] of Object.entries(fieldValues("legal", "sv", mode))) {
      if (!values[key]) values[key] = value;
    }
  }

  cache.set(cacheKey, { at: Date.now(), values });
  return values;
}

export function fieldValue(scope: FieldScope, locale: string, key: string, mode: ContentMode = "published"): string {
  return fieldValues(scope, locale, mode)[key] ?? "";
}

/* ------------------------------------------------------------------ writing */

function upsert(scope: FieldScope, key: string, locale: string, column: "draft" | "published", value: string | null, adminId: string): void {
  db.query(
    `INSERT INTO cms_fields (scope, key, locale, ${column}, updated_at, updated_by)
     VALUES ($s, $k, $l, $v, $t, $a)
     ON CONFLICT(scope, key, locale) DO UPDATE SET ${column} = excluded.${column}, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run({ $s: scope, $k: key, $l: locale, $v: value, $t: now(), $a: adminId });
}

export function saveDraft(scope: FieldScope, key: string, locale: string, value: string, adminId: string): void {
  const trimmed = value.trim();
  upsert(scope, key, locale, "draft", trimmed === "" ? null : trimmed, adminId);
  invalidateContentCache();
}

export function saveDrafts(scope: FieldScope, locale: string, entries: Record<string, string>, adminId: string): number {
  let changed = 0;
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      const def = ALL_FIELDS.find((f) => f.key === key);
      if (!def) continue;
      const trimmed = value.trim().slice(0, def.maxLength ?? 2000);
      upsert(scope, key, locale, "draft", trimmed === "" ? null : trimmed, adminId);
      changed++;
    }
  });
  tx();
  invalidateContentCache();
  return changed;
}

export function hasDraft(scope: FieldScope, locale: string): boolean {
  const row = db
    .query(
      `SELECT COUNT(*) AS c FROM cms_fields
       WHERE scope = $s AND locale = $l AND draft IS NOT NULL AND (published IS NULL OR published <> draft)`,
    )
    .get({ $s: scope, $l: locale }) as { c: number };
  return row.c > 0;
}

/* --------------------------------------------------------------- publishing */

export interface PublishResult {
  version: number;
  changed: number;
  publishedAt: string;
}

/**
 * Copies every draft to published and snapshots the complete published set as a
 * new version. Drafts that were never touched keep their published value.
 */
export function publish(scope: FieldScope, locale: string, adminId: string, note: string): PublishResult {
  const publishedAt = now();
  let changed = 0;
  let version = 0;

  const tx = db.transaction(() => {
    const drafts = db
      .query(`SELECT key, draft, published FROM cms_fields WHERE scope = $s AND locale = $l AND draft IS NOT NULL`)
      .all({ $s: scope, $l: locale }) as Array<{ key: string; draft: string | null; published: string | null }>;

    for (const row of drafts) {
      if (row.draft === row.published) continue;
      db.query(`UPDATE cms_fields SET published = $v, updated_at = $t, updated_by = $a WHERE scope = $s AND key = $k AND locale = $l`).run({
        $v: row.draft,
        $t: publishedAt,
        $a: adminId,
        $s: scope,
        $k: row.key,
        $l: locale,
      });
      changed++;
    }

    const max = db.query(`SELECT COALESCE(MAX(version), 0) AS v FROM cms_versions WHERE scope = $s`).get({ $s: scope }) as { v: number };
    version = max.v + 1;

    // Read the snapshot straight from the table: the in-process cache still
    // holds the pre-publish values until it is invalidated below.
    const snapshotRows = db
      .query(`SELECT key, published FROM cms_fields WHERE scope = $s AND locale = $l AND published IS NOT NULL`)
      .all({ $s: scope, $l: locale }) as Array<{ key: string; published: string }>;
    const snapshot: Record<string, string> = {};
    for (const row of snapshotRows) snapshot[row.key] = row.published;
    invalidateContentCache();
    db.query(
      `INSERT INTO cms_versions (id, scope, version, author, note, payload_json, created_at)
       VALUES ($id, $s, $v, $a, $n, $p, $c)`,
    ).run({
      $id: randomUUID(),
      $s: scope,
      $v: version,
      $a: adminId,
      $n: note.trim().slice(0, 300) || "Publicering",
      $p: JSON.stringify({ locale, values: snapshot }),
      $c: publishedAt,
    });
  });
  tx();
  invalidateContentCache();
  return { version, changed, publishedAt };
}

export interface VersionRow {
  id: string;
  scope: string;
  version: number;
  author: string | null;
  note: string | null;
  payload_json: string;
  created_at: string;
}

export function listVersions(scope: FieldScope, limit = 30): VersionRow[] {
  return db
    .query(`SELECT * FROM cms_versions WHERE scope = $s ORDER BY version DESC LIMIT $l`)
    .all({ $s: scope, $l: limit }) as VersionRow[];
}

export function getVersion(id: string): VersionRow | null {
  return (db.query(`SELECT * FROM cms_versions WHERE id = $id`).get({ $id: id }) as VersionRow | null) ?? null;
}

export function versionValues(row: VersionRow): { locale: string; values: Record<string, string> } {
  try {
    const parsed = JSON.parse(row.payload_json) as { locale?: string; values?: Record<string, string> };
    return { locale: parsed.locale ?? "sv", values: parsed.values ?? {} };
  } catch {
    return { locale: "sv", values: {} };
  }
}

/** Writes a snapshot back as drafts. Nothing becomes public until publish. */
export function restoreVersion(id: string, adminId: string): { restored: number } | null {
  const row = getVersion(id);
  if (!row) return null;
  const { locale, values } = versionValues(row);
  let restored = 0;
  const tx = db.transaction(() => {
    for (const def of ALL_FIELDS.filter((f) => f.scope === row.scope)) {
      const value = values[def.key] ?? "";
      upsert(row.scope as FieldScope, def.key, locale, "draft", value === "" ? null : value, adminId);
      restored++;
    }
  });
  tx();
  invalidateContentCache();
  return { restored };
}

/* ------------------------------------------------------------------ reports */

export interface ContentDiff {
  key: string;
  label: string;
  draft: string;
  published: string;
}

export function draftDiff(scope: FieldScope, locale: string): ContentDiff[] {
  const rows = db
    .query(`SELECT key, draft, published FROM cms_fields WHERE scope = $s AND locale = $l`)
    .all({ $s: scope, $l: locale }) as Array<{ key: string; draft: string | null; published: string | null }>;

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const out: ContentDiff[] = [];
  for (const def of ALL_FIELDS.filter((f) => f.scope === scope)) {
    const row = byKey.get(def.key);
    const draft = row?.draft ?? row?.published ?? "";
    const published = row?.published ?? "";
    if (draft !== published) out.push({ key: def.key, label: def.label, draft, published });
  }
  return out;
}

/** Required fields with no published value. Drives the blocker list. */
export function missingFields(scope: FieldScope, locale: string): FieldDef[] {
  const values = fieldValues(scope, locale, "published");
  return ALL_FIELDS.filter((field) => field.scope === scope && field.required && !values[field.key]);
}

/** Number of fields that still contain the visible "[FYLL I …]" marker. */
export function placeholderCount(scope: FieldScope, locale: string): number {
  const values = fieldValues(scope, locale, "published");
  return ALL_FIELDS.filter((field) => field.scope === scope && (values[field.key] ?? "").includes("FYLL I")).length;
}

export function fieldCoverage(scope: FieldScope, locale: string): { filled: number; total: number } {
  const values = fieldValues(scope, locale, "published");
  const fields = ALL_FIELDS.filter((f) => f.scope === scope);
  return { filled: fields.filter((f) => values[f.key]).length, total: fields.length };
}

/* -------------------------------------------------------------- admin audit */

export interface AdminAuditRow {
  id: number;
  admin_id: string | null;
  action: string;
  target: string | null;
  meta_json: string | null;
  ip: string | null;
  created_at: string;
}

export function logAdmin(input: { adminId: string | null; action: string; target?: string | null; ip?: string | null; meta?: Record<string, unknown> }): void {
  db.query(
    `INSERT INTO admin_audit (admin_id, action, target, meta_json, ip, created_at)
     VALUES ($a, $ac, $t, $m, $i, $c)`,
  ).run({
    $a: input.adminId,
    $ac: input.action,
    $t: input.target ?? null,
    $m: input.meta ? JSON.stringify(input.meta).slice(0, 2000) : null,
    $i: input.ip ?? null,
    $c: now(),
  });
}

export function recentAdminAudit(limit = 40): AdminAuditRow[] {
  return db.query(`SELECT * FROM admin_audit ORDER BY id DESC LIMIT $l`).all({ $l: limit }) as AdminAuditRow[];
}

export function recentAdminAuditFor(adminId: string, limit = 20): AdminAuditRow[] {
  return db
    .query(`SELECT * FROM admin_audit WHERE admin_id = $a ORDER BY id DESC LIMIT $l`)
    .all({ $a: adminId, $l: limit }) as AdminAuditRow[];
}
