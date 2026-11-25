/**
 * Time from sign-in to the first finished PDF.
 *
 * The number worth watching on this product is not how fast the engine is, but
 * how long it takes a new user to hold a report. It is measured from the session
 * created at sign-in to the first PDF generated for an analysis, and recorded
 * once per analysis so reloads and re-downloads cannot flatter the result.
 *
 * Storage is the existing `events` table, so there is no new schema and the
 * measurement can be removed by deleting one kind of event.
 */
import { db, logEvent } from "./db.ts";

export const TIME_TO_PDF_EVENT = "time_to_pdf";

export interface TimeToPdfStats {
  count: number;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

/** Records the first PDF for an analysis. Repeat calls are ignored. */
export function recordTimeToPdf(input: {
  userId: string;
  analysisId: string;
  rows: number;
  sessionStartedAt: number | null;
}): void {
  if (!input.sessionStartedAt || !Number.isFinite(input.sessionStartedAt)) return;
  const existing = db
    .query(`SELECT 1 AS one FROM events WHERE analysis_id = $a AND kind = $k LIMIT 1`)
    .get({ $a: input.analysisId, $k: TIME_TO_PDF_EVENT });
  if (existing) return;

  const seconds = Math.max(0, Math.round((Date.now() - input.sessionStartedAt) / 1000));
  logEvent({
    userId: input.userId,
    analysisId: input.analysisId,
    kind: TIME_TO_PDF_EVENT,
    message: JSON.stringify({ seconds, rows: input.rows }),
  });
}

/** Median and p90 across every measured analysis. */
export function timeToPdfStats(): TimeToPdfStats {
  const rows = db.query(`SELECT message FROM events WHERE kind = $k`).all({ $k: TIME_TO_PDF_EVENT }) as Array<{ message: string }>;
  const seconds = rows
    .map((row) => {
      try {
        const parsed = JSON.parse(row.message) as { seconds?: unknown };
        return typeof parsed.seconds === "number" && Number.isFinite(parsed.seconds) ? parsed.seconds : null;
      } catch {
        return null;
      }
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  if (!seconds.length) return { count: 0, medianSeconds: null, p90Seconds: null };
  const at = (share: number): number => seconds[Math.min(seconds.length - 1, Math.max(0, Math.ceil(seconds.length * share) - 1))]!;
  return { count: seconds.length, medianSeconds: at(0.5), p90Seconds: at(0.9) };
}

/** "3 min 40 s" / "48 s", the way a person would say it. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "–";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}
