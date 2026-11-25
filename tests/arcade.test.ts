import { describe, expect, test } from "bun:test";
import { TRUCK, knockedCones, signContact, stepTruck } from "../public/world/arcade.js";

/**
 * Explore mode is plain arcade physics and lives in a dependency-free module so
 * it can be tested here: the browser only draws what these functions return.
 */

const rest = { x: 0, z: 0, angle: 0, speed: 0 };

describe("gaffeltruckens rörelse", () => {
  test("framåt accelererar mot toppfarten och stannar inom ramen", () => {
    let state = { ...rest };
    for (let i = 0; i < 200; i++) state = stepTruck(state, { forward: 1, turn: 0 }, 1 / 60);
    expect(state.speed).toBeCloseTo(TRUCK.maxSpeed, 1);
    expect(state.z).toBeLessThan(0);
    expect(state.z).toBeGreaterThanOrEqual(TRUCK.bounds.zMin);
    expect(state.x).toBe(0);
  });

  test("backen går långsammare än framåt", () => {
    let state = { ...rest };
    for (let i = 0; i < 200; i++) state = stepTruck(state, { forward: -1, turn: 0 }, 1 / 60);
    expect(state.speed).toBeCloseTo(-TRUCK.reverseSpeed, 1);
    expect(state.z).toBeLessThanOrEqual(TRUCK.bounds.zMax);
  });

  test("sväng ändrar riktning och sidled", () => {
    let state = { ...rest };
    state = stepTruck(state, { forward: 1, turn: 1 }, 1);
    expect(state.angle).toBeCloseTo(TRUCK.turnRate, 3);
    expect(state.x).toBeGreaterThan(0);
  });

  test("trucken kan inte köra utanför lagergolvet", () => {
    let state = { ...rest };
    for (let i = 0; i < 600; i++) state = stepTruck(state, { forward: 1, turn: 0.2 }, 0.1);
    expect(Math.abs(state.x)).toBeLessThanOrEqual(TRUCK.bounds.x);
    expect(state.z).toBeGreaterThanOrEqual(TRUCK.bounds.zMin);
    expect(state.z).toBeLessThanOrEqual(TRUCK.bounds.zMax);
  });

  test("ingen inmatning behåller riktningen men tappar fart", () => {
    const moving = { x: 0, z: 0, angle: 0.4, speed: 4 };
    const next = stepTruck(moving, { forward: 0, turn: 0 }, 0.05);
    expect(next.angle).toBeCloseTo(0.4, 6);
    expect(next.speed).toBeGreaterThan(0);
    expect(next.speed).toBeLessThan(4);
    // Half a second without input is a full stop.
    expect(stepTruck(moving, { forward: 0, turn: 0 }, 0.5).speed).toBe(0);
  });

  test("negativ eller saknad dt flyttar ingenting", () => {
    const state = { x: 1, z: 2, angle: 0.2, speed: 3 };
    expect(stepTruck(state, { forward: 1, turn: 1 }, -1)).toEqual({ x: 1, z: 2, angle: 0.2, speed: state.speed + (TRUCK.maxSpeed - state.speed) * 0 });
  });
});

describe("koner och skyltar", () => {
  const cones = [
    { x: 0, z: 0, down: 0 },
    { x: 5, z: 0, down: 0 },
    { x: 0, z: 0.5, down: 123 },
  ];

  test("koner inom radien markeras, redan vält kon ignoreras", () => {
    expect(knockedCones(cones, 0.2, 0.2)).toEqual([0]);
    expect(knockedCones(cones, 50, 50)).toEqual([]);
    const all = knockedCones(cones, 0, 0, 10);
    expect(all).not.toContain(2);
  });

  test("skyltkontakt kräver närhet och ger rätt destination", () => {
    const signs = [
      { x: 0, z: 0, label: "Priser", href: "/priser" },
      { x: 8, z: 0, label: "Om oss", href: "/om-oss" },
    ];
    expect(signContact(signs, 1, 0)?.href).toBe("/priser");
    expect(signContact(signs, 4, 0)).toBeNull();
  });
});
