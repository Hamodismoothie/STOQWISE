import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  DURATION,
  EASING,
  MOTION_STORAGE_KEY,
  STAGGER,
  readStoredMotion,
  resolveMotionPreference,
  writeStoredMotion,
} from "../src/ui/motion.ts";
import {
  PERF,
  clampDpr,
  createQualityGovernor,
  createRenderGate,
  detectWebGL,
  effectiveDpr,
} from "../src/ui/perf.ts";

const CSS = readFileSync(new URL("../public/v3.css", import.meta.url), "utf8");

describe("rörelsetokens", () => {
  test("durations är 120/240/480/800 ms", () => {
    expect(DURATION).toEqual({ fast: 120, base: 240, slow: 480, slower: 800 });
  });

  test("CSS och TypeScript delar samma durations och easings", () => {
    expect(CSS).toContain(`--dur-fast: ${DURATION.fast}ms;`);
    expect(CSS).toContain(`--dur-base: ${DURATION.base}ms;`);
    expect(CSS).toContain(`--dur-slow: ${DURATION.slow}ms;`);
    expect(CSS).toContain(`--dur-slower: ${DURATION.slower}ms;`);
    expect(CSS).toContain(`--stagger-step: ${STAGGER.step}ms;`);
    expect(CSS).toContain(`--ease-standard: ${EASING.standard};`);
    expect(CSS).toContain(`--ease-emphasis: ${EASING.emphasis};`);
  });

  test("pausad rörelse stängs av med ett attribut i CSS", () => {
    expect(CSS).toContain('[data-motion="paused"] *');
    expect(CSS).toContain("animation-duration: 1ms !important");
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("rörelsepreferens", () => {
  test("systempreferens används när användaren inte valt", () => {
    expect(resolveMotionPreference(true, null)).toEqual({ enabled: false, source: "system" });
    expect(resolveMotionPreference(false, null)).toEqual({ enabled: true, source: "system" });
  });

  test("användarens val vinner över systemet", () => {
    expect(resolveMotionPreference(false, true)).toEqual({ enabled: false, source: "user" });
    expect(resolveMotionPreference(true, false)).toEqual({ enabled: true, source: "user" });
  });

  test("växeln sparas och läses tillbaka", () => {
    const store = new Map<string, string>();
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    try {
      expect(readStoredMotion()).toBeNull();
      expect(writeStoredMotion(true)).toBe(true);
      expect(store.get(MOTION_STORAGE_KEY)).toBe("paused");
      expect(readStoredMotion()).toBe(true);
      expect(writeStoredMotion(false)).toBe(true);
      expect(readStoredMotion()).toBe(false);
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = original;
    }
  });

  test("blockerad lagring ger null och false i stället för krasch", () => {
    const original = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    try {
      expect(readStoredMotion()).toBeNull();
      expect(writeStoredMotion(true)).toBe(false);
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = original;
    }
  });
});

describe("prestandabudget", () => {
  test("DPR kapas per enhetsklass", () => {
    expect(clampDpr(3, false)).toBe(PERF.dprCapDesktop);
    expect(clampDpr(3, true)).toBe(PERF.dprCapMobile);
    expect(clampDpr(1, false)).toBe(1);
    expect(clampDpr(Number.NaN, false)).toBe(1);
    expect(effectiveDpr(2, 3, false)).toBe(2);
    expect(effectiveDpr(1, 3, false)).toBeLessThanOrEqual(PERF.dprCapDesktop);
    expect(effectiveDpr(0, 3, true)).toBeLessThanOrEqual(PERF.dprCapMobile);
  });

  test("kvaliteten sänks efter 2 s långsamma frames – och bara nedåt", () => {
    const steps: number[] = [];
    const governor = createQualityGovernor({ onDowngrade: (level) => steps.push(level) });
    expect(governor.level()).toBe(2);

    // 126 frames à 30 ms, 16 ms isär: fönstret på 2 s är då täckt.
    for (let i = 0; i < 126; i++) governor.sample(30, i * 16);
    expect(governor.level()).toBe(1);
    expect(governor.lastReason()).toContain("22 ms");

    // Ett snabbt parti får inte höja kvaliteten igen.
    for (let i = 0; i < 20; i++) governor.sample(8, 2100 + i * 16);
    expect(governor.level()).toBe(1);

    for (let i = 0; i < 250; i++) governor.sample(35, 2500 + i * 16);
    expect(governor.level()).toBe(0);
    expect(steps).toEqual([1, 0]);
  });

  test("en enstaka långsam frame sänker inte kvaliteten", () => {
    const governor = createQualityGovernor();
    governor.sample(200, 0);
    governor.sample(10, 16);
    expect(governor.level()).toBe(2);
  });

  test("renderloopen stannar när fliken eller canvas är utanför viewport", () => {
    const gate = createRenderGate();
    const events: boolean[] = [];
    gate.onChange((active) => events.push(active));
    expect(gate.isActive()).toBe(true);

    gate.setHidden(true);
    expect(gate.isActive()).toBe(false);
    gate.setHidden(true);
    expect(events).toEqual([false]);

    gate.setHidden(false);
    expect(gate.isActive()).toBe(true);

    gate.setIntersecting(false);
    expect(gate.isActive()).toBe(false);
    expect(events).toEqual([false, true, false]);
  });

  test("WebGL-detektering faller tillbaka utan krasch", () => {
    expect(detectWebGL(() => ({ getContext: () => null }))).toBe(false);
    expect(detectWebGL(() => ({ getContext: (kind: string) => (kind === "webgl2" ? {} : null) }))).toBe(true);
    expect(
      detectWebGL(() => {
        throw new Error("WebGL is disabled");
      }),
    ).toBe(false);
    expect(detectWebGL(() => null)).toBe(false);
  });
});
