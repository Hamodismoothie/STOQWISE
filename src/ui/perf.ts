/**
 * Performance budget for the animated surface (demo + 3D scene).
 *
 * Three guards, all in one place:
 *   - the render loop stops when the canvas is off-screen or the tab is hidden
 *   - quality steps down when frames are slow, never back up automatically
 *     (oscillating between quality levels is worse than staying low)
 *   - device pixel ratio is capped per device class, so a 3× phone screen does
 *     not render 9× the pixels
 *
 * The pure parts are unit-tested; the DOM wiring is a thin adapter at the end.
 */

export const PERF = {
  /** A frame slower than this counts against the budget. */
  frameBudgetMs: 22,
  /** Rolling window used to judge quality. */
  windowMs: 2000,
  dprCapDesktop: 2,
  dprCapMobile: 1.5,
  /** DPR multiplier per quality level: 2 = full, 1 = reduced, 0 = minimal. */
  dprScale: { 2: 1, 1: 0.7, 0: 0.6 } as Record<QualityLevel, number>,
  /** Effects that are switched off at the lowest level. */
  effects: {
    2: { bloom: true, shadows: true },
    1: { bloom: true, shadows: false },
    0: { bloom: false, shadows: false },
  } as Record<QualityLevel, { bloom: boolean; shadows: boolean }>,
} as const;

export type QualityLevel = 0 | 1 | 2;

export function clampDpr(deviceDpr: number, isMobile: boolean): number {
  const cap = isMobile ? PERF.dprCapMobile : PERF.dprCapDesktop;
  const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
  return Math.min(dpr, cap);
}

/** Pixel ratio to hand to the renderer for a level and device. */
export function effectiveDpr(level: QualityLevel, deviceDpr: number, isMobile: boolean): number {
  return Math.round(clampDpr(deviceDpr, isMobile) * PERF.dprScale[level] * 100) / 100;
}

export interface QualityGovernor {
  /** Feed one measured frame. Returns the level in force afterwards. */
  sample(frameMs: number, atMs?: number): QualityLevel;
  level(): QualityLevel;
  /** Human-readable reason for the last downgrade, for logs and tests. */
  lastReason(): string | null;
  reset(level?: QualityLevel): void;
}

/**
 * Rolling-average governor. It only steps down: slow frames cost quality,
 * quality is never traded back automatically.
 */
export function createQualityGovernor(options: { start?: QualityLevel; onDowngrade?: (level: QualityLevel, reason: string) => void } = {}): QualityGovernor {
  let current: QualityLevel = options.start ?? 2;
  let samples: Array<{ ms: number; at: number }> = [];
  let reason: string | null = null;
  let clock: number | null = null;

  return {
    sample(frameMs: number, atMs?: number): QualityLevel {
      if (current === 0 || !Number.isFinite(frameMs) || frameMs < 0) return current;
      const at = atMs ?? (clock === null ? 0 : clock + 16);
      clock = at;
      samples.push({ ms: frameMs, at });
      const cutoff = at - PERF.windowMs;
      samples = samples.filter((s) => s.at >= cutoff);
      if (samples.length === 0) return current;
      const span = samples[samples.length - 1]!.at - samples[0]!.at;
      // Judge only once the window is actually covered; a single slow first
      // frame must not drop the whole scene.
      if (span < PERF.windowMs) return current;
      const average = samples.reduce((a, s) => a + s.ms, 0) / samples.length;
      if (average <= PERF.frameBudgetMs) return current;
      const next = (current - 1) as QualityLevel;
      reason = `snitt ${average.toFixed(1)} ms över ${PERF.frameBudgetMs} ms i ${PERF.windowMs} ms`;
      current = next;
      samples = [];
      options.onDowngrade?.(current, reason);
      return current;
    },
    level: () => current,
    lastReason: () => reason,
    reset(level: QualityLevel = 2) {
      current = level;
      samples = [];
      reason = null;
      clock = null;
    },
  };
}

/** Render only when the canvas is on screen and the tab is visible. */
export interface RenderGate {
  setHidden(hidden: boolean): void;
  setIntersecting(intersecting: boolean): void;
  isActive(): boolean;
  onChange(fn: (active: boolean) => void): void;
}

export function createRenderGate(initial: { hidden?: boolean; intersecting?: boolean } = {}): RenderGate {
  let hidden = initial.hidden ?? false;
  let intersecting = initial.intersecting ?? true;
  let last = !hidden && intersecting;
  const listeners: Array<(active: boolean) => void> = [];
  const emit = () => {
    const active = !hidden && intersecting;
    if (active === last) return;
    last = active;
    for (const fn of listeners) fn(active);
  };
  return {
    setHidden(next) {
      hidden = next;
      emit();
    },
    setIntersecting(next) {
      intersecting = next;
      emit();
    },
    isActive: () => !hidden && intersecting,
    onChange(fn) {
      listeners.push(fn);
    },
  };
}

/* ------------------------------------------------------------- browser glue
   The project compiles without `lib.dom`, so browser globals are described
   structurally and read through `globalThis`. Everything above is pure. */

export interface CanvasLike {
  getContext(kind: string): unknown;
}

interface DocumentLike {
  visibilityState?: string;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  createElement(tag: string): CanvasLike;
}

interface ObserverLike {
  observe(target: unknown): void;
  disconnect(): void;
}

type ObserverCtor = new (cb: (entries: Array<{ isIntersecting: boolean }>) => void) => ObserverLike;

const browserDocument = (): DocumentLike | null =>
  (globalThis as { document?: DocumentLike }).document ?? null;

/** WebGL availability, without throwing on locked-down browsers. */
export function detectWebGL(createCanvas?: () => CanvasLike | null): boolean {
  try {
    const canvas = createCanvas
      ? createCanvas()
      : (browserDocument()?.createElement("canvas") ?? null);
    if (!canvas) return false;
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Browser wiring: pauses on `visibilitychange`, on `IntersectionObserver` and
 * when the user paused animation. Returns a cleanup function.
 */
export function attachRenderGate(
  element: unknown | null,
  gate: RenderGate,
  options: { motionAllowed?: () => boolean } = {},
): () => void {
  const doc = browserDocument();
  if (!doc) return () => {};
  const onVisibility = () =>
    gate.setHidden(doc.visibilityState === "hidden" || !(options.motionAllowed?.() ?? true));
  onVisibility();
  doc.addEventListener("visibilitychange", onVisibility);

  let observer: ObserverLike | null = null;
  const Observer = (globalThis as { IntersectionObserver?: ObserverCtor }).IntersectionObserver;
  if (element && typeof Observer === "function") {
    observer = new Observer((entries) => {
      for (const entry of entries) gate.setIntersecting(entry.isIntersecting);
    });
    observer.observe(element);
  }
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    observer?.disconnect();
  };
}
