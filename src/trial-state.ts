/**
 * The trial is a calendar window, not a plan label. Every surface reads its
 * state from the same function so the banner, the write guard and the mail
 * lifecycle cannot disagree about whether the trial has ended.
 */
export const TRIAL_DAYS = 14;
export const DAY_MS = 86_400_000;

export interface TrialState {
  isTrial: boolean;
  endsAt: string | null;
  endsAtMs: number | null;
  daysLeft: number;
  ended: boolean;
}

export function trialState(
  org: { plan: string; trial_ends_at?: string | null },
  nowMs = Date.now(),
): TrialState {
  const isTrial = org.plan === "trial";
  const endsAt = org.trial_ends_at ?? null;
  const endsAtMs = endsAt ? Date.parse(endsAt) : null;
  const validEnd = endsAtMs !== null && Number.isFinite(endsAtMs);
  const ended = isTrial && validEnd && nowMs >= endsAtMs!;
  const daysLeft = isTrial && validEnd ? Math.max(0, Math.ceil((endsAtMs! - nowMs) / DAY_MS)) : 0;
  return {
    isTrial,
    endsAt,
    endsAtMs: validEnd ? endsAtMs : null,
    daysLeft,
    ended,
  };
}

export function trialEndIso(nowMs = Date.now(), days = TRIAL_DAYS): string {
  return new Date(nowMs + days * DAY_MS).toISOString();
}