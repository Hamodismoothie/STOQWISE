/**
 * Motion tokens and the single reduced-motion switch.
 *
 * Two inputs decide whether the product animates:
 *   1. the operating system (`prefers-reduced-motion`)
 *   2. the user's own "Pausa animationer" switch, persisted in localStorage
 *
 * Nothing else may decide. Every animation reads these constants, so durations
 * and easings cannot drift between the marketing site, the demo and the app.
 */

/** Duration scale in milliseconds. Mirrors `--dur-*` in `public/v3.css`. */
export const DURATION = {
  fast: 120,
  base: 240,
  slow: 480,
  slower: 800,
} as const;

/** Easing curves. Mirrors `--ease-*` in `public/v3.css`. */
export const EASING = {
  standard: "cubic-bezier(0.2, 0.6, 0.2, 1)",
  emphasis: "cubic-bezier(0.16, 1, 0.3, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** Delay between siblings in a staggered reveal. */
export const STAGGER = {
  step: 40,
  max: 320,
} as const;

export const MOTION_STORAGE_KEY = "lr-motion";

export type MotionSource = "system" | "user";
export type MotionPreference = {
  /** True when animation is allowed at all. */
  enabled: boolean;
  /** Which input decided it. A user choice always wins over the system. */
  source: MotionSource;
};

/**
 * Pure decision function: stored value is `null` when the user never chose.
 * `stored` is `true` when the user has paused animation.
 */
export function resolveMotionPreference(prefersReduced: boolean, storedPaused: boolean | null): MotionPreference {
  if (storedPaused === true) return { enabled: false, source: "user" };
  if (storedPaused === false) return { enabled: true, source: "user" };
  return { enabled: !prefersReduced, source: "system" };
}

/**
 * Minimal browser shapes.
 *
 * The project compiles without the DOM library (it renders HTML on the server),
 * so the few browser globals this module needs are described structurally and
 * read through `globalThis` instead of relying on `lib.dom`.
 */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface MediaQueryLike {
  matches: boolean;
}

interface DocumentLike {
  documentElement: { dataset: Record<string, string> };
}

const storage = (): StorageLike | null => {
  try {
    const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
    return candidate ?? null;
  } catch {
    // Accessing localStorage throws in some privacy modes.
    return null;
  }
};

/** Reads the persisted switch. Returns null when nothing is stored or storage is blocked. */
export function readStoredMotion(): boolean | null {
  const store = storage();
  if (!store) return null;
  try {
    const value = store.getItem(MOTION_STORAGE_KEY);
    if (value === "paused") return true;
    if (value === "on") return false;
    return null;
  } catch {
    return null;
  }
}

/** Persists the switch. Returns false when storage is unavailable. */
export function writeStoredMotion(paused: boolean): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(MOTION_STORAGE_KEY, paused ? "paused" : "on");
    return true;
  } catch {
    return false;
  }
}

/** True when the OS asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  const matchMedia = (globalThis as { matchMedia?: (query: string) => MediaQueryLike }).matchMedia;
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Applies the decision to the document: `data-motion="paused"` disables CSS
 * animation and tells any canvas loop to stop. Safe to call on the server.
 */
export function applyMotionPreference(
  preference: MotionPreference = resolveMotionPreference(prefersReducedMotion(), readStoredMotion()),
): MotionPreference {
  const doc = (globalThis as { document?: DocumentLike }).document;
  if (!doc) return preference;
  doc.documentElement.dataset.motion = preference.enabled ? "on" : "paused";
  return preference;
}
