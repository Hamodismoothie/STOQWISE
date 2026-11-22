/**
 * Versioned schema migrations.
 *
 * The app never assumes a fresh database: an existing 1.x installation is
 * upgraded in place, one numbered step at a time, inside a transaction. The
 * current version lives in `PRAGMA user_version`, so a deploy can tell exactly
 * what shape the data is in without a separate migrations table.
 *
 * Rules for adding a migration:
 *   - append, never edit a released step
 *   - one concern per step, so a failure is easy to reason about
 *   - the step must be safe to run on a database that already has the columns
 *     (SQLite has no `ADD COLUMN IF NOT EXISTS`)
 */
import { Database } from "bun:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

function addColumn(db: Database, table: string, definition: string): void {
  const name = definition.split(/\s+/)[0]!;
  if (!hasColumn(db, table, name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline: users, sessions, analyses, events, leads",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
          name TEXT NOT NULL, company TEXT, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS analyses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          filename TEXT NOT NULL, status TEXT NOT NULL,
          rows INTEGER NOT NULL DEFAULT 0,
          input_json TEXT, result_json TEXT, narrative_json TEXT, error TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, analysis_id TEXT,
          kind TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS leads (
          id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
          company TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: "multi-tenant organisations, roles and memberships",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          plan TEXT NOT NULL DEFAULT 'trial',
          trial_ends_at TEXT,
          settings_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS members (
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (org_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);

        CREATE TABLE IF NOT EXISTS invitations (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          role TEXT NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          accepted_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          org_id TEXT,
          user_id TEXT,
          action TEXT NOT NULL,
          target TEXT,
          ip TEXT,
          meta_json TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(org_id, id DESC);
      `);

      addColumn(db, "analyses", "org_id TEXT");
      addColumn(db, "analyses", "warehouse TEXT");
      addColumn(db, "analyses", "source TEXT");
      addColumn(db, "analyses", "period_months INTEGER");
      addColumn(db, "analyses", "summary_json TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_analyses_org ON analyses(org_id, created_at DESC)");
    },
  },
  {
    version: 3,
    name: "normalized items for filtering, sorting and large datasets",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
          org_id TEXT NOT NULL,
          sku TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT,
          supplier TEXT,
          warehouse TEXT,
          stock REAL NOT NULL DEFAULT 0,
          cost REAL NOT NULL DEFAULT 0,
          price REAL,
          value REAL NOT NULL DEFAULT 0,
          sold REAL NOT NULL DEFAULT 0,
          revenue REAL NOT NULL DEFAULT 0,
          profit REAL NOT NULL DEFAULT 0,
          margin_pct REAL,
          cover_days REAL,
          turns REAL NOT NULL DEFAULT 0,
          abc TEXT,
          xyz TEXT,
          action TEXT,
          priority REAL NOT NULL DEFAULT 0,
          extra_json TEXT,
          PRIMARY KEY (analysis_id, sku)
        );
        CREATE INDEX IF NOT EXISTS idx_items_org_sku ON items(org_id, sku);
        CREATE INDEX IF NOT EXISTS idx_items_analysis_value ON items(analysis_id, value DESC);
        CREATE INDEX IF NOT EXISTS idx_items_analysis_action ON items(analysis_id, action);
      `);
    },
  },
  {
    version: 4,
    name: "integrations: api keys, webhooks, imports, schedules",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          prefix TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          scopes TEXT NOT NULL DEFAULT 'read',
          last_used_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhooks (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          url TEXT NOT NULL,
          secret TEXT NOT NULL,
          events TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          status TEXT NOT NULL,
          response_code INTEGER,
          attempts INTEGER NOT NULL DEFAULT 1,
          error TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          analysis_id TEXT,
          source TEXT NOT NULL,
          filename TEXT NOT NULL,
          rows INTEGER NOT NULL DEFAULT 0,
          imported INTEGER NOT NULL DEFAULT 0,
          skipped INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error TEXT,
          log_json TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_imports_org ON imports(org_id, started_at DESC);

        CREATE TABLE IF NOT EXISTS sync_schedules (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          integration_id TEXT NOT NULL,
          frequency TEXT NOT NULL,
          config_json TEXT,
          next_run_at TEXT,
          last_run_at TEXT,
          last_status TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 5,
    name: "copilot conversations, scenarios, saved views, subscriptions",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          analysis_id TEXT,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations(org_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          payload_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scenarios (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          analysis_id TEXT NOT NULL,
          name TEXT NOT NULL,
          input_json TEXT NOT NULL,
          result_json TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_views (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          query_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subscriptions (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL UNIQUE,
          plan TEXT NOT NULL,
          status TEXT NOT NULL,
          seats INTEGER NOT NULL DEFAULT 1,
          current_period_end TEXT,
          stripe_customer_id TEXT,
          stripe_subscription_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    name: "personalised pricing profiles, commercial rules, quotes and planning",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pricing_profiles (
          org_id TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
          profile_json TEXT NOT NULL,
          estimate_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pricing_rules (
          id TEXT PRIMARY KEY,
          rules_json TEXT NOT NULL,
          updated_by TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pricing_quotes (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id TEXT,
          profile_json TEXT NOT NULL,
          estimate_json TEXT NOT NULL,
          status TEXT NOT NULL,
          note TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pricing_quotes_org ON pricing_quotes(org_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS commercial_scenarios (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id TEXT,
          name TEXT NOT NULL,
          input_json TEXT NOT NULL,
          output_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_commercial_scenarios_org ON commercial_scenarios(org_id, created_at DESC);
      `);
    },
  },
];

export function migrate(db: Database): { from: number; to: number; applied: string[] } {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version ?? 0;
  const applied: string[] = [];
  const target = migrations[migrations.length - 1]!.version;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const tx = db.transaction(() => {
      migration.up(db);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
    tx();
    applied.push(`${migration.version}: ${migration.name}`);
  }

  return { from: current, to: target, applied };
}
