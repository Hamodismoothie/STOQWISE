/**
 * The explore-mode physics is plain JavaScript in `public/world/arcade.js` (it
 * ships to the browser untouched). This declaration gives the test suite its
 * types without pulling every public script into the TypeScript program.
 */
declare module "*/arcade.js" {
  export interface TruckState {
    x: number;
    z: number;
    angle: number;
    speed: number;
  }
  export const TRUCK: {
    maxSpeed: number;
    reverseSpeed: number;
    smoothing: number;
    turnRate: number;
    bounds: { x: number; zMin: number; zMax: number };
  };
  export function stepTruck(state: TruckState, input: { forward?: number; turn?: number }, dt: number): TruckState;
  export function knockedCones(
    cones: Array<{ x: number; z: number; down: number }>,
    x: number,
    z: number,
    radius?: number,
  ): number[];
  export function signContact<T extends { x: number; z: number }>(
    signs: T[],
    x: number,
    z: number,
    radius?: number,
  ): T | null;
}
