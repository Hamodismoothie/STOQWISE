/**
 * Historical value points for the dashboard trend.
 *
 * One point per import day, newest 24 days. Several imports on the same day are
 * analyses of the same business day, not extra months of history: plotting all
 * of them produced "24 points" that all carried today's date. The newest
 * analysis of a day wins because it reflects the latest data for that day.
 */

export interface RawValuePoint {
  date: string;
  value: number | null;
}

export interface ValuePoint {
  date: string;
  value: number;
}

const timestamp = (date: string): number => {
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Expects rows newest first (the order of the SQL query). Invalid or negative
 * values are dropped; a genuine zero inventory is kept because it is a valid
 * business state, unlike a missing summary.
 */
export function collapseDailyValues(rows: RawValuePoint[], limit = 24): ValuePoint[] {
  const valid = rows
    .filter((row): row is ValuePoint => typeof row.value === "number" && Number.isFinite(row.value) && row.value >= 0)
    .sort((a, b) => timestamp(b.date) - timestamp(a.date));

  const byDay = new Map<string, ValuePoint>();
  for (const row of valid) {
    const day = row.date.slice(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, { date: row.date, value: row.value });
  }

  return [...byDay.values()]
    .sort((a, b) => timestamp(a.date) - timestamp(b.date))
    .slice(-Math.max(1, limit));
}
