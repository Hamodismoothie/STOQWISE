/**
 * Arcade driving for the explore mode, kept free of three.js so the physics can
 * be tested without a browser. The renderer calls `stepTruck` once per frame and
 * reads `knockedCones` for the cones that should tip over.
 *
 * Deliberately simple: accelerate towards a target speed, turn in place, clamp
 * to the warehouse floor. No inertia beyond one smoothing term, no collisions
 * with racks - the mode is a playful detour, not a simulation.
 */
export const TRUCK = {
  maxSpeed: 6.5,
  reverseSpeed: 3.2,
  smoothing: 4,
  turnRate: 1.6,
  bounds: { x: 14, zMin: -24, zMax: 8 },
};

/**
 * @param {{x:number,z:number,angle:number,speed:number}} state
 * @param {{forward:number,turn:number}} input  forward −1..1, turn −1..1
 * @param {number} dt seconds
 */
export function stepTruck(state, input, dt) {
  const forward = Math.max(-1, Math.min(1, input.forward || 0));
  const turn = Math.max(-1, Math.min(1, input.turn || 0));
  const target = forward >= 0 ? forward * TRUCK.maxSpeed : forward * TRUCK.reverseSpeed;
  const blend = Math.min(1, Math.max(0, dt) * TRUCK.smoothing);
  const speed = state.speed + (target - state.speed) * blend;
  const angle = state.angle + turn * TRUCK.turnRate * Math.max(0, dt);
  // Angle 0 faces into the hall (negative z); the dock is behind the driver.
  const x = Math.max(-TRUCK.bounds.x, Math.min(TRUCK.bounds.x, state.x + Math.sin(angle) * speed * Math.max(0, dt)));
  const z = Math.max(TRUCK.bounds.zMin, Math.min(TRUCK.bounds.zMax, state.z - Math.cos(angle) * speed * Math.max(0, dt)));
  return { x, z, angle, speed };
}

/** Indices of cones within `radius` of the truck. */
export function knockedCones(cones, x, z, radius = 1.1) {
  const hits = [];
  cones.forEach((cone, index) => {
    if (cone.down) return;
    if (Math.hypot(cone.x - x, cone.z - z) < radius) hits.push(index);
  });
  return hits;
}

/** True when the truck is close enough to a sign to read it. */
export function signContact(signs, x, z, radius = 1.9) {
  return signs.find((sign) => Math.hypot(sign.x - x, sign.z - z) < radius) ?? null;
}
