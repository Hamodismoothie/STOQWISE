/**
 * The import pipeline, shared by the web UI and the JSON API.
 *
 * One code path means a fix in the importer fixes every entry point, and it means
 * the API cannot drift away from what the UI does. The pipeline is also where
 * plan limits are enforced, so no entry point can bypass them.
 */
import { randomUUID } from "node:crypto";
import { analyze, type AnalysisResult, type AnalysisSettings } from "./analysis.ts";
import { buildDataset, type DatasetResult } from "./dataset.ts";
import { detectMapping, parseMonthHeader, type DetectedMapping } from "./mapping.ts";
import { buildIntelligence, type IntelligenceSnapshot } from "./core/intelligence.ts";
import { buildTemplateNarrative, type Narrative } from "./insights.ts";
import { parseUpload } from "./integrations/index.ts";
import { db, insertAnalysis, logEvent } from "./db.ts";
import {
  finishImport,
  limitsFor,
  replaceItems,
  startImport,
  type ItemRowInput,
} from "./data/repo.ts";
import type { ParsedCsv } from "./csv.ts";
import { dispatchEvent } from "./webhooks.ts";

export interface PreviewResult {
  draftId: string;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  mapping: DetectedMapping;
  warnings: string[];
  source: string;
}

export interface IngestInput {
  orgId: string;
  userId: string;
  bytes: Uint8Array;
  filename: string;
  source?: string;
  warehouse?: string;
  integrationId?: string;
  settings?: Partial<AnalysisSettings>;
  /** Mapping overrides coming from the manual mapping step. */
  mappingOverride?: Partial<DetectedMapping["columns"]> | null;
  monthColumnIndexes?: number[] | null;
  totalSoldColumnIndex?: number | null;
}

export type IngestOutcome =
  | { ok: true; analysisId: string; result: AnalysisResult; intelligence: IntelligenceSnapshot; narrative: Narrative; warnings: string[] }
  | { ok: false; error: string; warnings: string[]; importId: string };

const now = (): string => new Date().toISOString();

function applyMappingOverride(parsed: ParsedCsv, detected: DetectedMapping, input: IngestInput): DetectedMapping {
  if (!input.mappingOverride && !input.monthColumnIndexes) return detected;

  const columns = { ...detected.columns };
  if (input.mappingOverride) {
    for (const [key, value] of Object.entries(input.mappingOverride)) {
      if (value !== undefined && value !== null) {
        (columns as Record<string, number | null>)[key] = value as number | null;
      }
    }
  }

  let monthColumns = detected.monthColumns;
  if (input.monthColumnIndexes && input.monthColumnIndexes.length > 0) {
    monthColumns = input.monthColumnIndexes
      .filter((i) => i >= 0 && i < parsed.headers.length)
      .map((index) => {
        const header = parsed.headers[index] ?? `kolumn ${index + 1}`;
        return { index, month: parseMonthHeader(header) ?? header, label: header };
      });
  }

  const demandMode = monthColumns.length >= 2 ? "wide" : columns.totalSold !== null ? "total" : "none";
  return {
    ...detected,
    columns,
    monthColumns,
    demandMode,
    periodMonths: monthColumns.length || detected.periodMonths,
  };
}

/** Stores a parsed upload so the mapping step survives a reload. */
export async function preview(input: {
  orgId: string;
  userId: string;
  bytes: Uint8Array;
  filename: string;
  integrationId?: string;
}): Promise<PreviewResult> {
  const { parsed, source } = await parseUpload({
    bytes: input.bytes,
    filename: input.filename,
    integrationId: input.integrationId,
  });
  if (parsed.rows.length === 0) {
    throw new Error("Filen innehåller inga datarader. Kontrollera att första raden är rubriker och att filen inte är tom.");
  }
  if (parsed.rows.length > 500_000) {
    throw new Error("Filen har fler än 500 000 rader. Dela upp den per lager eller år.");
  }

  const mapping = detectMapping(parsed.headers, parsed.rows);
  const draftId = randomUUID();

  db.query(
    `INSERT INTO analyses (id, user_id, org_id, filename, status, rows, input_json, source, created_at)
     VALUES ($id, $u, $o, $f, 'draft', $r, $ij, $s, $c)`,
  ).run({
    $id: draftId,
    $u: input.userId,
    $o: input.orgId,
    $f: input.filename,
    $r: parsed.rows.length,
    $ij: JSON.stringify({ headers: parsed.headers, rows: parsed.rows, delimiter: parsed.delimiter, source }),
    $s: source,
    $c: now(),
  });

  return {
    draftId,
    headers: parsed.headers,
    sampleRows: parsed.rows.slice(0, 5),
    rowCount: parsed.rows.length,
    mapping,
    warnings: parsed.warnings,
    source,
  };
}

export function draftFor(orgId: string, draftId: string) {
  return (
    (db
      .query("SELECT id, filename, rows, input_json, source FROM analyses WHERE id = $id AND org_id = $o AND status = 'draft'")
      .get({ $id: draftId, $o: orgId }) as { id: string; filename: string; rows: number; input_json: string; source: string | null } | null) ??
    null
  );
}

/** Full run: parse, validate, analyze, score, persist. */
export async function ingest(input: IngestInput): Promise<IngestOutcome> {
  const importId = startImport({ orgId: input.orgId, source: input.source ?? "upload", filename: input.filename });
  const limits = limitsFor(
    (db.query("SELECT plan FROM organizations WHERE id = $o").get({ $o: input.orgId }) as { plan: string } | null)?.plan ?? "trial",
  );

  try {
    const { parsed, source, meta } = await parseUpload({
      bytes: input.bytes,
      filename: input.filename,
      integrationId: input.integrationId,
    });

    const detected = detectMapping(parsed.headers, parsed.rows);
    const mapping = applyMappingOverride(parsed, detected, input);

    const dataset: DatasetResult = buildDataset(parsed, mapping);
    if (dataset.errors.length > 0) {
      finishImport({
        id: importId,
        status: "failed",
        analysisId: null,
        rows: parsed.rows.length,
        imported: 0,
        skipped: 0,
        error: dataset.errors.join(" "),
        log: { warnings: dataset.warnings, errors: dataset.errors },
      });
      return { ok: false, error: dataset.errors.join(" "), warnings: dataset.warnings, importId };
    }

    if (dataset.items.length > limits.maxSkus) {
      const message = `Underlaget har ${dataset.items.length.toLocaleString("sv-SE")} artiklar, men abonnemanget ${limits.name} tillåter ${limits.maxSkus.toLocaleString("sv-SE")}. Uppgradera eller dela upp filen per lager.`;
      finishImport({ id: importId, status: "failed", analysisId: null, rows: parsed.rows.length, imported: dataset.items.length, skipped: dataset.stats.rowsSkipped, error: message, log: null });
      return { ok: false, error: message, warnings: dataset.warnings, importId };
    }

    const settings: Partial<AnalysisSettings> = {
      ...(input.settings ?? {}),
      months: mapping.periodMonths > 0 ? mapping.periodMonths : 12,
    };
    const result = analyze(dataset.items, settings, dataset.warnings);

    const snapshots = (
      db
        .query(
          `SELECT created_at AS date, json_extract(summary_json, '$.inventoryValue') AS value
           FROM analyses WHERE org_id = $o AND status = 'ok' AND summary_json IS NOT NULL
           ORDER BY created_at ASC LIMIT 24`,
        )
        .all({ $o: input.orgId }) as Array<{ date: string; value: number }>
    ).filter((s) => typeof s.value === "number" && s.value > 0);

    const intelligence = buildIntelligence(dataset.items, result, {
      months: mapping.periodMonths || 12,
      monthLabels: mapping.monthColumns.map((c) => c.month),
      snapshots,
      deadStockDays: result.settings.deadStockDays,
    });

    const narrative = buildTemplateNarrative(result, {
      company: (db.query("SELECT name FROM organizations WHERE id = $o").get({ $o: input.orgId }) as { name: string } | null)?.name ?? "Företaget",
      filename: input.filename,
    });

    const analysisId = insertAnalysis({
      userId: input.userId,
      filename: input.filename,
      status: "ok",
      rows: dataset.items.length,
      inputJson: null,
      resultJson: JSON.stringify(result),
      narrativeJson: JSON.stringify(narrative),
      error: null,
    });

    // The legacy insert has no org column, so we set it in the same transaction
    // as the item rows. Nothing is visible to the org until both are written.
    const tx = db.transaction(() => {
      db.query(
        `UPDATE analyses SET org_id = $o, warehouse = $w, source = $s, period_months = $p, summary_json = $sum
         WHERE id = $id`,
      ).run({
        $o: input.orgId,
        $w: input.warehouse ?? "Huvudlager",
        $s: source,
        $p: mapping.periodMonths || 12,
        $sum: JSON.stringify({
          inventoryValue: result.kpis.inventoryValue,
          deadStockValue: result.kpis.deadStockValue,
          skuCount: result.kpis.skuCount,
          health: intelligence.health.score,
        }),
        $id: analysisId,
      });

      const rows: ItemRowInput[] = intelligence.items.map((item) => ({
        sku: item.sku,
        name: item.name,
        category: item.category,
        supplier: item.supplier,
        stock: item.stock,
        cost: item.cost,
        price: item.price,
        value: item.value,
        sold: item.soldPeriod,
        revenue: item.revenuePeriod,
        profit: item.profitPeriod,
        marginPct: item.marginPct,
        coverDays: item.coverDays,
        turns: item.turns,
        abc: item.abcValue,
        xyz: item.xyz,
        action: item.action,
        priority: item.priorityScore,
        extra: {
          abcRevenue: item.abcRevenue,
          abcProfit: item.abcProfit,
          velocity: item.velocity,
          marginPct: item.marginPct,
          overstockValue: item.overstockValue,
          reorderPoint: item.reorderPoint,
          seasonalIndex: item.seasonalIndex,
          anomalyCount: item.anomalyCount,
        },
      }));
      replaceItems(input.orgId, analysisId, input.warehouse ?? "Huvudlager", rows);
    });
    tx();

    finishImport({
      id: importId,
      status: "ok",
      analysisId,
      rows: parsed.rows.length,
      imported: dataset.items.length,
      skipped: dataset.stats.rowsSkipped,
      error: null,
      log: { warnings: dataset.warnings, stats: dataset.stats, meta },
    });

    logEvent({
      userId: input.userId,
      analysisId,
      kind: "analysis.created",
      message: `${input.filename}: ${dataset.items.length} artiklar, lagervärde ${result.kpis.inventoryValue}.`,
    });

    void dispatchEvent(input.orgId, "analysis.completed", {
      analysisId,
      filename: input.filename,
      inventoryValue: result.kpis.inventoryValue,
      deadStockValue: result.kpis.deadStockValue,
      skuCount: result.kpis.skuCount,
    });

    return { ok: true, analysisId, result, intelligence, narrative, warnings: dataset.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Okänt fel vid import.";
    finishImport({ id: importId, status: "failed", analysisId: null, rows: 0, imported: 0, skipped: 0, error: message, log: null });
    return { ok: false, error: message, warnings: [], importId };
  }
}

/** Runs the pipeline on a stored draft (the mapping step). */
export async function ingestDraft(input: {
  orgId: string;
  userId: string;
  draftId: string;
  mappingOverride?: Partial<DetectedMapping["columns"]> | null;
  monthColumnIndexes?: number[] | null;
  settings?: Partial<AnalysisSettings>;
  warehouse?: string;
}): Promise<IngestOutcome> {
  const draft = draftFor(input.orgId, input.draftId);
  if (!draft) return { ok: false, error: "Utkastet hittades inte eller tillhör en annan organisation.", warnings: [], importId: "" };

  const payload = JSON.parse(draft.input_json) as { headers: string[]; rows: string[][]; delimiter: string };
  const csv = rebuildCsv(payload.headers, payload.rows, payload.delimiter);

  const outcome = await ingest({
    orgId: input.orgId,
    userId: input.userId,
    bytes: new TextEncoder().encode(csv),
    filename: draft.filename,
    source: draft.source ?? "upload",
    mappingOverride: input.mappingOverride,
    monthColumnIndexes: input.monthColumnIndexes,
    settings: input.settings,
    warehouse: input.warehouse,
  });

  if (outcome.ok) db.query("DELETE FROM analyses WHERE id = $id AND org_id = $o").run({ $id: input.draftId, $o: input.orgId });
  return outcome;
}

/** Re-serialises stored rows so the draft path reuses the exact same importer. */
export function rebuildCsv(headers: string[], rows: string[][], delimiter = ";"): string {
  const quote = (value: string): string =>
    /["\n\r;,\t]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const all = [headers, ...rows].map((row) => row.map(quote).join(delimiter));
  return all.join("\n");
}
