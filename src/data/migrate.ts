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
  {
    version: 7,
    name: "administration: CMS fields, versions and admin accounts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'owner',
          totp_secret TEXT,
          totp_enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token_hash TEXT PRIMARY KEY,
          admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          ip TEXT
        );

        CREATE TABLE IF NOT EXISTS cms_fields (
          scope TEXT NOT NULL,
          key TEXT NOT NULL,
          locale TEXT NOT NULL,
          draft TEXT,
          published TEXT,
          updated_at TEXT NOT NULL,
          updated_by TEXT,
          PRIMARY KEY (scope, key, locale)
        );

        CREATE TABLE IF NOT EXISTS cms_versions (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          version INTEGER NOT NULL,
          author TEXT,
          note TEXT,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cms_versions_scope_version
          ON cms_versions(scope, version);

        CREATE TABLE IF NOT EXISTS admin_audit (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          admin_id TEXT,
          action TEXT NOT NULL,
          target TEXT,
          meta_json TEXT,
          ip TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_admin_audit_recent ON admin_audit(id DESC);
      `);
    },
  },
  {
    version: 8,
    name: "platform administration: account status, test tenants, limits and settings",
    up: (db) => {
      addColumn(db, "users", "status TEXT NOT NULL DEFAULT 'active'");
      addColumn(db, "organizations", "kind TEXT NOT NULL DEFAULT 'customer'");
      addColumn(db, "organizations", "status TEXT NOT NULL DEFAULT 'active'");
      addColumn(db, "organizations", "limits_json TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS platform_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          updated_by TEXT
        );
      `      );
    },
  },
  {
    version: 9,
    name: "password reset tokens and transactional mail log",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS password_resets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TEXT NOT NULL,
          used_at TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

        CREATE TABLE IF NOT EXISTS mail_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          to_email TEXT NOT NULL,
          subject TEXT NOT NULL,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          provider_id TEXT,
          error TEXT,
          body TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mail_log_recent ON mail_log(id DESC);
      `);
    },
  },
  {
    version: 10,
    name: "invitation locale so mail and page share the inviter's language",
    up: (db) => {
      // Pending invitations were mailed in Swedish before this column existed,
      // so Swedish is the honest default for those links.
      addColumn(db, "invitations", "locale TEXT NOT NULL DEFAULT 'sv'");
    },
  },
  {
    version: 11,
    name: "trial lifecycle: fixed end date and idempotent mail markers",
    up: (db) => {
      addColumn(db, "organizations", "trial_welcome_sent_at TEXT");
      addColumn(db, "organizations", "trial_midpoint_sent_at TEXT");
      addColumn(db, "organizations", "trial_ending_sent_at TEXT");
      addColumn(db, "organizations", "trial_ended_sent_at TEXT");
      // A trial without an end is not a trial, it is an indefinite free plan.
      // Existing rows get the same fourteen days from their creation date.
      db.exec(`
        UPDATE organizations
        SET trial_ends_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+14 days')
        WHERE trial_ends_at IS NULL
      `);
    },
  },
  {
    version: 12,
    name: "user and organisation locale",
    up: (db) => {
      // Existing accounts saw Swedish product copy and received Swedish mail
      // before a stored locale existed, so Swedish is the honest upgrade value.
      addColumn(db, "users", "locale TEXT NOT NULL DEFAULT 'sv'");
      addColumn(db, "organizations", "locale TEXT NOT NULL DEFAULT 'sv'");
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
