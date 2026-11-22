/**
 * REST API v1.
 *
 * Authentication is a bearer key (stored as a hash) scoped to one organisation.
 * Every query is organisation-scoped; there is no endpoint that accepts an id and
 * returns another tenant's rows. Write endpoints require the `write` scope and
 * are rate limited per key.
 *
 * Errors follow one shape: { error, message } with a stable machine-readable
 * `error` so a client can branch without parsing prose.
 */
import { analyze, type AnalysisResult } from "./analysis.ts";
import { EMAILS } from "./brand.ts";
import { buildIntelligence } from "./core/intelligence.ts";
import { ask, type ConversationTurn } from "./core/copilot.ts";
import { buildBaseline, simulate, type ScenarioInput } from "./core/simulate.ts";
import { forecastSeries, supplyPlan } from "./core/forecast.ts";
import { getItem, limitsFor, planLimits, queryItems, findApiKey, type ItemQuery } from "./data/repo.ts";
import { db } from "./db.ts";
import { json, rateLimit, type RequestContext } from "./http.ts";
import { ingest, rebuildCsv } from "./pipeline.ts";
import { buildPdf } from "./pdf.ts";
import { writeXlsx } from "./xlsx.ts";
import type { ItemInput } from "./dataset.ts";
import { buildTemplateNarrative } from "./insights.ts";
import { detectLanguage } from "./terminology.ts";

export interface ApiAuth {
  orgId: string;
  scopes: string;
  keyId: string;
}

export function apiAuth(ctx: RequestContext): ApiAuth | Response {
  const header = ctx.req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) return json({ error: "unauthorized", message: "Ange Authorization: Bearer <api-nyckel>." }, 401);
  const key = findApiKey(token);
  if (!key) return json({ error: "unauthorized", message: "API-nyckeln är okänd eller återkallad." }, 401);

  const limit = rateLimit(`api:${key.id}`, 240, 60);
  if (!limit.ok) {
    return json({ error: "rate_limited", message: "För många anrop. Försök igen om en stund." }, 429, {
      "retry-after": String(limit.retryAfter),
    });
  }
  return { orgId: key.org_id, scopes: key.scopes, keyId: key.id };
}

function requireScope(auth: ApiAuth, scope: "read" | "write"): Response | null {
  if (scope === "read") return null;
  if (auth.scopes !== "write") return json({ error: "forbidden", message: "Nyckeln saknar skrivscope." }, 403);
  return null;
}

export function loadAnalysis(orgId: string, id: string) {
  const row = db
    .query("SELECT * FROM analyses WHERE id = $id AND org_id = $o AND status = 'ok'")
    .get({ $id: id, $o: orgId }) as
    | { id: string; filename: string; rows: number; result_json: string; narrative_json: string | null; created_at: string; period_months: number | null; warehouse: string | null }
    | null;
  if (!row) return null;
  return {
    row,
    result: JSON.parse(row.result_json) as AnalysisResult,
    narrative: row.narrative_json ? JSON.parse(row.narrative_json) : null,
  };
}

/** Rebuilds engine input from a stored result so forecasts can run without re-importing. */
export function rebuildInputs(result: AnalysisResult): ItemInput[] {
  return result.items.map((i) => ({
    sku: i.sku,
    name: i.name,
    category: i.category,
    subcategory: i.subcategory ?? null,
    brand: i.brand ?? null,
    unit: i.unit ?? null,
    shelfLifeDays: i.shelfLifeDays ?? null,
    storage: i.storage ?? null,
    supplier: i.supplier,
    stock: i.stock,
    reserved: i.reserved,
    cost: i.cost,
    price: i.price,
    leadTimeDays: i.leadTimeDays,
    moq: null,
    monthly: i.monthlyDemand,
    totalSold: i.soldPeriod,
    totalRevenue: i.revenuePeriod,
  }));
}

function orgName(orgId: string): string {
  return (db.query("SELECT name FROM organizations WHERE id = $o").get({ $o: orgId }) as { name: string } | null)?.name ?? "Företaget";
}

export async function handleApi(ctx: RequestContext): Promise<Response | null> {
  const path = ctx.url.pathname;
  if (!path.startsWith("/api/v1")) return null;

  if (path === "/api/v1/health") return json({ status: "ok", version: "2.0.0", time: new Date().toISOString() });

  const auth = apiAuth(ctx);
  if (auth instanceof Response) return auth;
  const segments = path.replace("/api/v1/", "").split("/").filter(Boolean);

  /* -------------------------------------------------------------- /me */
  if (segments[0] === "me" && segments.length === 1) {
    const org = db.query("SELECT name, plan FROM organizations WHERE id = $o").get({ $o: auth.orgId }) as
      | { name: string; plan: string }
      | null;
    return json({
      organization: org,
      plan: planLimits[org?.plan ?? "trial"],
      scopes: auth.scopes,
      analyses: (db.query("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $o AND status = 'ok'").get({ $o: auth.orgId }) as { c: number }).c,
    });
  }

  /* -------------------------------------------------------- /analyses */
  if (segments[0] === "analyses") {
    if (segments.length === 1 && ctx.req.method === "GET") {
      const rows = db
        .query(
          `SELECT id, filename, rows, source, warehouse, period_months, created_at
           FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 100`,
        )
        .all({ $o: auth.orgId });
      return json({ data: rows });
    }

    if (segments.length === 1 && ctx.req.method === "POST") {
      const denied = requireScope(auth, "write");
      if (denied) return denied;
      let form: Awaited<ReturnType<Request["formData"]>>;
      try {
        form = await ctx.req.formData();
      } catch {
        return json({ error: "bad_request", message: "Förväntade multipart/form-data med fältet file." }, 400);
      }
      const file = form.get("file");
      if (!(file instanceof File)) return json({ error: "bad_request", message: "Fältet file saknas." }, 400);

      const limits = limitsFor((db.query("SELECT plan FROM organizations WHERE id = $o").get({ $o: auth.orgId }) as { plan: string } | null)?.plan ?? "trial");
      const used = (
        db.query("SELECT COUNT(*) AS c FROM analyses WHERE org_id = $o AND status = 'ok' AND created_at >= $s").get({
          $o: auth.orgId,
          $s: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString(),
        }) as { c: number }
      ).c;
      if (used >= limits.maxAnalysesPerMonth) {
        return json({ error: "plan_limit", message: `Planen ${limits.name} tillåter ${limits.maxAnalysesPerMonth} analyser per månad.` }, 402);
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const owner = (db
        .query("SELECT user_id FROM members WHERE org_id = $o ORDER BY created_at ASC LIMIT 1")
        .get({ $o: auth.orgId }) as { user_id: string } | null)?.user_id;
      if (!owner) return json({ error: "org_empty", message: "Organisationen saknar medlemmar." }, 409);

      const outcome = await ingest({
        orgId: auth.orgId,
        userId: owner,
        bytes,
        filename: file.name || "api-upload.csv",
        source: "api",
        warehouse: String(form.get("warehouse") ?? "Huvudlager"),
      });
      if (!outcome.ok) return json({ error: "import_failed", message: outcome.error, warnings: outcome.warnings }, 422);
      return json(
        {
          id: outcome.analysisId,
          skus: outcome.result.kpis.skuCount,
          inventoryValue: outcome.result.kpis.inventoryValue,
          deadStockValue: outcome.result.kpis.deadStockValue,
          warnings: outcome.warnings,
        },
        201,
      );
    }

    const id = segments[1];
    if (!id) return json({ error: "not_found" }, 404);
    const found = loadAnalysis(auth.orgId, id);
    if (!found) return json({ error: "not_found", message: "Analysen finns inte i organisationen." }, 404);

    if (segments.length === 2) {
      const k = found.result.kpis;
      return json({
        id,
        filename: found.row.filename,
        created_at: found.row.created_at,
        period_months: found.row.period_months,
        warehouse: found.row.warehouse,
        kpis: k,
        abc: found.result.abc,
        xyz: found.result.xyz,
        assumptions: found.result.assumptions,
        recommendations: found.result.recommendations,
      });
    }

    if (segments[2] === "items") {
      const q: ItemQuery = {
        q: ctx.url.searchParams.get("q") ?? undefined,
        lang:
          ctx.url.searchParams.get("lang") === "sv"
            ? "sv"
            : ctx.url.searchParams.get("lang") === "en"
              ? "en"
              : detectLanguage(ctx.url.searchParams.get("q") ?? ""),
        category: ctx.url.searchParams.get("category") ?? undefined,
        action: ctx.url.searchParams.get("action") ?? undefined,
        abc: ctx.url.searchParams.get("abc") ?? undefined,
        xyz: ctx.url.searchParams.get("xyz") ?? undefined,
        sort: (ctx.url.searchParams.get("sort") as ItemQuery["sort"]) ?? "value",
        dir: (ctx.url.searchParams.get("dir") as "asc" | "desc") ?? "desc",
        page: Number(ctx.url.searchParams.get("page") ?? 1),
        pageSize: Number(ctx.url.searchParams.get("pageSize") ?? 50),
      };
      const result = queryItems(auth.orgId, id, q);
      return json({ data: result.rows, pagination: { total: result.total, page: result.page, pages: result.pages } });
    }

    if (segments[2] === "forecast") {
      const inputs = rebuildInputs(found.result);
      const sku = ctx.url.searchParams.get("sku");
      const horizon = Math.min(24, Math.max(1, Number(ctx.url.searchParams.get("horizon") ?? 6)));
      const freq = (ctx.url.searchParams.get("frequency") ?? "month") as "month" | "week" | "day";
      const targets = sku ? inputs.filter((i) => i.sku === sku) : inputs.filter((i) => i.monthly).slice(0, 25);
      if (targets.length === 0) return json({ error: "not_found", message: "Ingen artikel med månadshistorik matchade." }, 404);
      const data = targets.map((item) => {
        const f = forecastSeries(item.monthly ?? [], { horizon, frequency: freq });
        const plan = supplyPlan(item, f, { serviceLevel: found.result.settings.serviceLevel });
        return { sku: item.sku, name: item.name, forecast: f, plan };
      });
      return json({ data });
    }

    if (segments[2] === "simulate" && ctx.req.method === "POST") {
      const denied = requireScope(auth, "write");
      if (denied) return denied;
      const body = (await ctx.req.json().catch(() => ({}))) as Partial<ScenarioInput>;
      const baseline = buildBaseline(rebuildInputs(found.result), found.result.dataQuality.months);
      const outcome = simulate(baseline, body);
      return json({ scenario: outcome.input, totals: outcome.totals, delta: outcome.delta, risks: outcome.risks, byCategory: outcome.byCategory, formulas: outcome.formulas });
    }

    if (segments[2] === "export.xlsx") {
      const items = queryItems(auth.orgId, id, { pageSize: 200, page: 1 }).rows;
      const sheet = writeXlsx({
        name: "Artiklar",
        columns: [
          { header: "Artikel", width: 18 },
          { header: "Benämning", width: 40 },
          { header: "Kategori", width: 18 },
          { header: "Leverantör", width: 22 },
          { header: "Saldo", width: 12 },
          { header: "Inköpspris", width: 14 },
          { header: "Lagervärde", width: 16 },
          { header: "Sålt", width: 12 },
          { header: "Omsättning", width: 14 },
          { header: "Täckning (d)", width: 14 },
          { header: "Marginal %", width: 14 },
          { header: "ABC", width: 8 },
          { header: "XYZ", width: 8 },
          { header: "Åtgärd", width: 16 },
        ],
        rows: items.map((r) => [
          String(r.sku),
          String(r.name),
          String(r.category ?? ""),
          String(r.supplier ?? ""),
          Number(r.stock),
          Number(r.cost),
          Number(r.value),
          Number(r.sold),
          Number(r.turns),
          r.cover_days === null ? "" : Number(r.cover_days),
          r.margin_pct === null ? "" : Number(r.margin_pct),
          String(r.abc ?? ""),
          String(r.xyz ?? ""),
          String(r.action ?? ""),
        ]),
      });
      return new Response(sheet, {
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="lagerradar-${id.slice(0, 8)}.xlsx"`,
        },
      });
    }

    if (segments[2] === "report.pdf") {
      const narrative = found.narrative ?? buildTemplateNarrative(found.result, { company: orgName(auth.orgId), filename: found.row.filename });
      const pdf = await buildPdf(found.result, narrative, {
        company: orgName(auth.orgId),
        filename: found.row.filename,
        generatedAt: found.row.created_at,
        contactEmail: EMAILS.hello ?? undefined,
      });
      return new Response(pdf, {
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="lagerrapport.pdf"` },
      });
    }

    return json({ error: "not_found" }, 404);
  }

  /* -------------------------------------------------------- /copilot */
  if (segments[0] === "copilot" && ctx.req.method === "POST") {
    const denied = requireScope(auth, "write");
    if (denied) return denied;
    const body = (await ctx.req.json().catch(() => ({}))) as { question?: string; analysisId?: string; conversation?: ConversationTurn[] };
    if (!body.question) return json({ error: "bad_request", message: "Fältet question krävs." }, 400);
    const id =
      body.analysisId ??
      (db.query("SELECT id FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 1").get({ $o: auth.orgId }) as { id: string } | null)?.id;
    if (!id) return json({ error: "not_found", message: "Ingen analys finns i organisationen." }, 404);
    const found = loadAnalysis(auth.orgId, id);
    if (!found) return json({ error: "not_found" }, 404);

    const inputs = rebuildInputs(found.result);
    const intel = buildIntelligence(inputs, found.result, { months: found.result.dataQuality.months });
    const snapshots = db
      .query("SELECT created_at AS date, json_extract(summary_json, '$.inventoryValue') AS value FROM analyses WHERE org_id = $o AND status = 'ok' AND summary_json IS NOT NULL ORDER BY created_at ASC LIMIT 24")
      .all({ $o: auth.orgId }) as Array<{ date: string; value: number }>;

    const answer = ask(
      { result: found.result, intelligence: intel, items: inputs, company: orgName(auth.orgId), months: found.result.dataQuality.months, snapshots },
      body.question,
      body.conversation ?? [],
    );
    return json(answer);
  }

  /* ------------------------------------------------------ /items/:sku */
  if (segments[0] === "items" && segments.length === 2) {
    const row = getItem(auth.orgId, (db.query("SELECT id FROM analyses WHERE org_id = $o AND status = 'ok' ORDER BY created_at DESC LIMIT 1").get({ $o: auth.orgId }) as { id: string } | null)?.id ?? "", segments[1]!);
    if (!row) return json({ error: "not_found" }, 404);
    return json({ data: row });
  }

  return json({ error: "not_found", message: `Okänd endpoint: ${path}` }, 404);
}

export { analyze, rebuildCsv };
