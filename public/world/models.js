/**
 * Reusable warehouse props.
 *
 * The 3D scenes used to draw every pallet and rack member as a single stretched
 * box, which is what made the warehouse read as a wall of cuboids. These
 * builders merge the few real parts of each object (deck boards, blocks, beams,
 * cartons) into one BufferGeometry, so an InstancedMesh still draws thousands of
 * them in one call: detail without extra draw calls.
 *
 * Dimensions are metres, taken from a standard EUR pallet (1200 × 800 × 144 mm)
 * and a selective pallet rack with a 1.1 m beam level.
 */
import * as THREE from "/vendor/three/three.module.js";

/** Concatenates translated boxes into one indexed geometry. */
export function mergeBoxes(specs) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  let vertexOffset = 0;

  for (const spec of specs) {
    const geometry = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    geometry.translate(spec.x ?? 0, spec.y ?? 0, spec.z ?? 0);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      uvs.push(uv.getX(i), uv.getY(i));
    }
    const index = geometry.getIndex();
    for (let i = 0; i < index.count; i++) indices.push(vertexOffset + index.getX(i));
    vertexOffset += position.count;
    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeBoundingSphere();
  return merged;
}

/** Standard EUR pallet footprint and deck height. */
export const PALLET = { w: 0.8, d: 1.0, h: 0.146 };
/** Clear stacking height of one full carton load on a pallet. */
export const LOAD_HEIGHT = 0.78;

const cache = new Map();
function cached(key, build) {
  let value = cache.get(key);
  if (!value) {
    value = build();
    cache.set(key, value);
  }
  return value;
}

/**
 * EUR pallet: three top deck boards, three bottom boards and six blocks.
 * 11 boxes / 132 triangles, which is cheap enough to instance four per slot.
 */
export function palletGeometry() {
  return cached("pallet", () => {
    const specs = [];
    for (const x of [-0.27, 0, 0.27]) {
      specs.push({ w: 0.21, h: 0.024, d: PALLET.d, x, y: 0.134 });
      specs.push({ w: 0.14, h: 0.022, d: PALLET.d, x, y: 0.011 });
    }
    for (const x of [-0.27, 0, 0.27]) {
      for (const z of [-0.34, 0.34]) {
        specs.push({ w: 0.12, h: 0.098, d: 0.12, x, y: 0.06, z });
      }
    }
    return mergeBoxes(specs);
  });
}

/**
 * Carton load on one pallet: three layers, varied box heights and a small
 * offset per layer so the stack reads as packed goods rather than one block.
 */
export function loadGeometry(variant = 0) {
  return cached(`load:${variant}`, () => {
    const specs = [];
    const layerHeights = variant === 1 ? [0.27, 0.23, 0.3] : [0.24, 0.3, 0.26];
    const cartonW = 0.34;
    const cartonD = 0.44;
    let base = PALLET.h;
    for (let layer = 0; layer < layerHeights.length; layer++) {
      let layerTop = 0;
      for (let ix = 0; ix < 2; ix++) {
        for (let iz = 0; iz < 2; iz++) {
          const seed = (ix + iz * 2 + layer + variant) % 4;
          const height = layerHeights[layer] - seed * 0.012;
          const jitterX = ((seed % 2) - 0.5) * 0.016;
          const jitterZ = (((seed + layer) % 2) - 0.5) * 0.014;
          specs.push({
            w: cartonW - 0.02,
            h: height,
            d: cartonD - 0.02,
            x: (ix - 0.5) * cartonW + jitterX,
            z: (iz - 0.5) * cartonD + jitterZ,
            y: base + layerTop + height / 2,
          });
          layerTop = Math.max(layerTop, height);
        }
      }
      base += layerHeights[layer];
    }
    return mergeBoxes(specs);
  });
}

/** Rack upright with a bolted foot plate. */
export function uprightGeometry(height = 6) {
  return cached(`upright:${height}`, () =>
    mergeBoxes([
      { w: 0.09, h: height - 0.04, d: 0.09, y: (height - 0.04) / 2 + 0.04 },
      { w: 0.2, h: 0.02, d: 0.2, y: 0.01 },
    ]),
  );
}

/**
 * Step beam seen from the aisle: a vertical face and a top flange, the two
 * surfaces that make orange racking recognisable.
 */
export function beamGeometry(length = 1.88) {
  return cached(`beam:${length.toFixed(2)}`, () =>
    mergeBoxes([
      { w: 0.05, h: 0.1, d: length, y: -0.01 },
      { w: 0.13, h: 0.035, d: length, x: 0.04, y: 0.038 },
    ]),
  );
}

/** Yellow upright protector standing on the aisle floor. */
export function protectorGeometry() {
  return cached("protector", () =>
    mergeBoxes([
      { w: 0.16, h: 0.72, d: 0.05, z: 0.09, y: 0.36 },
      { w: 0.16, h: 0.72, d: 0.05, z: -0.09, y: 0.36 },
      { w: 0.05, h: 0.72, d: 0.13, x: 0.09, y: 0.36 },
      { w: 0.05, h: 0.72, d: 0.13, x: -0.09, y: 0.36 },
    ]),
  );
}
