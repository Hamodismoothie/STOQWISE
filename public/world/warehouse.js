/**
 * The public warehouse world.
 *
 * Loaded as an ES module after first paint (see `v3.js`), so the landing page
 * never waits for three.js. Everything the reader needs - headings, figures,
 * links, slider values - is already in the DOM; this file only draws.
 *
 * The scene uses the same props as the signed-in Lagervärld (`world/models.js`):
 * selective pallet racking with uprights, step beams and protectors, EUR pallets
 * and layered carton loads. One article occupies one pallet position, arranged
 * into rack rows by category and ordered by distance to the dock (the ABC story
 * the section tells). Placement is a drawing decision made in the browser from
 * the server's demo scene - no coordinates or inventory figures are invented,
 * and the section is labelled as synthetic demo data.
 *
 * Data contract: the JSON payload in `[data-world-data]` is built server-side by
 * `buildWarehouseScene` (same adapter as the app). The "what if" sliders call
 * `/api/v1/demo/what-if`, which runs the real analysis engine.
 */
import * as THREE from "/vendor/three/three.module.js";
import { effectiveDpr } from "/perf.js";
import { knockedCones, stepTruck } from "/world/arcade.js";
import { cardboardTexture, woodTexture } from "/world/textures.js";
import {
  LOAD_HEIGHT,
  PALLET,
  beamGeometry,
  loadGeometry,
  palletGeometry,
  protectorGeometry,
  uprightGeometry,
} from "/world/models.js";

const BAY = 2.0;
const LEVEL_H = 1.32;
const LEVELS = 3;
const RACK_HEIGHT = 4.2;
const ROW_GAP = 3.4;
const STOCKOUT_PULSE_HZ = 0.5;
const CONE_RESET_MS = 8000;
const STATUS_COLOR = {
  balanced: 0xb9c7b4,
  overstock: 0xd9a35f,
  stockout: 0xc96a5c,
  inactive: 0x767f7a,
};

const reducedMotionQuery = () =>
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)").matches : false;

function webglAvailable() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function palette() {
  const style = getComputedStyle(document.documentElement);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    night: read("--midnight", "#0c1512"),
    paper: read("--paper", "#f6f4ef"),
    copper: read("--copper-bright", "#c88968"),
  };
}

/** Demo layout: one rack row per category, articles ordered from the dock. */
function buildLayouts(environments) {
  return environments.map((environment) => {
    const aisles = [...environment.aisles].sort((a, b) => a.index - b.index);
    const rows = aisles.map((aisle) =>
      environment.racks.filter((rack) => rack.aisle === aisle.index).sort((a, b) => a.depth - b.depth),
    );
    const longest = Math.max(1, ...rows.map((row) => row.length));
    // Same row length everywhere, so "depth" means the same distance to the dock
    // in every aisle. Six positions per bay (two pallets × three levels).
    const bays = Math.max(4, Math.min(8, Math.ceil(longest / 4)));
    const rowCount = Math.max(1, aisles.length);
    const spanX = (rowCount - 1) * ROW_GAP;
    const frames = [];
    const slots = [];

    aisles.forEach((aisle, rowIndex) => {
      const x = -spanX / 2 + rowIndex * ROW_GAP;
      const frame = {
        x,
        z: -bays * BAY,
        bays,
        levels: LEVELS,
        rowIndex,
        category: aisle.category,
        label: String(rowIndex + 1).padStart(2, "0"),
      };
      frames.push(frame);
      const articles = rows[rowIndex];
      let cursor = 0;
      // Fill the floor level first (pick face), then the levels above it.
      for (let level = 0; level < LEVELS; level++) {
        for (let side = 0; side < 2; side++) {
          for (let bay = 0; bay < bays; bay++) {
            if (cursor >= articles.length) continue;
            const rack = articles[cursor++];
            slots.push({
              ...rack,
              pattern: rack.pattern || "smooth",
              x,
              z: frame.z + bay * BAY + BAY / 2 + (side ? 0.5 : -0.5),
              level,
              bay,
              side,
              rowIndex,
            });
          }
        }
      }
    });

    const depth = bays * BAY;
    return {
      id: environment.id,
      environment,
      frames,
      slots,
      bays,
      depth,
      width: Math.max(spanX + 2.6, 10),
      rowCount,
    };
  });
}

export function createWorld({ root, canvas, data, locale = "sv", onStats }) {
  const sv = locale !== "en";
  const colors = palette();
  const reduced = reducedMotionQuery();
  const hasWebgl = webglAvailable();
  const coarse = typeof matchMedia === "function" ? matchMedia("(pointer: coarse)").matches : false;
  const renderer = hasWebgl
    ? new THREE.WebGLRenderer({
        canvas,
        antialias: !coarse,
        alpha: false,
        powerPreference: "high-performance",
      })
    : null;
  if (renderer) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.48;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  const layouts = buildLayouts(data);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(colors.night);
  scene.fog = new THREE.FogExp2(colors.night, 0.0042);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.3, 260);

  /* ------------------------------------------------------------- lighting */
  scene.add(new THREE.HemisphereLight(0xeaf2ec, 0x14201c, 2.05));
  const key = new THREE.DirectionalLight(0xfff1da, 3.1);
  key.position.set(-26, 38, 24);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db8c6, 0.8);
  fill.position.set(30, 18, -26);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.36));

  const dummy = new THREE.Object3D();
  const maxSlots = Math.max(1, ...layouts.map((layout) => layout.slots.length));
  const maxPattern = { smooth: 0, striped: 0, dotted: 0 };
  for (const layout of layouts) {
    for (const slot of layout.slots) maxPattern[slot.pattern] = (maxPattern[slot.pattern] ?? 0) + 1;
  }
  const maxUprights = Math.max(1, ...layouts.map((layout) => layout.frames.reduce((sum, frame) => sum + (frame.bays + 1) * 2, 0)));
  const maxBeams = Math.max(
    1,
    ...layouts.map((layout) => layout.frames.reduce((sum, frame) => sum + frame.bays * frame.levels * 2, 0)),
  );
  const maxProtectors = Math.max(1, ...layouts.map((layout) => layout.frames.length * 2));
  const maxLines = maxProtectors;

  /* -------------------------------------------------------------- materials */
  const boardTexture = cardboardTexture(1);
  const timberTexture = woodTexture(2);
  const loadTextures = makeLoadTextures();
  const patternTextures = makePatternTextures();
  const palletMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: timberTexture ?? null,
    roughness: 0.9,
    metalness: 0.02,
  });
  const detailLoadMaterials = {
    smooth: new THREE.MeshStandardMaterial({ map: loadTextures.smooth, roughness: 0.88, metalness: 0.01 }),
    striped: new THREE.MeshStandardMaterial({ map: loadTextures.striped, roughness: 0.88, metalness: 0.01 }),
    dotted: new THREE.MeshStandardMaterial({ map: loadTextures.dotted, roughness: 0.88, metalness: 0.01 }),
  };
  const farLoadMaterials = {
    smooth: new THREE.MeshStandardMaterial({ map: patternTextures.smooth, roughness: 0.85, metalness: 0.02 }),
    striped: new THREE.MeshStandardMaterial({ map: patternTextures.striped, roughness: 0.85, metalness: 0.02 }),
    dotted: new THREE.MeshStandardMaterial({ map: patternTextures.dotted, roughness: 0.85, metalness: 0.02 }),
  };
  const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6f68, roughness: 0.5, metalness: 0.46 });
  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0xc07d3e, roughness: 0.42, metalness: 0.38 });
  const protectorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a34a, roughness: 0.6, metalness: 0.18 });
  const tapeMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.92, metalness: 0 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x050a08, transparent: true, opacity: 0.3, depthWrite: false });

  /* ------------------------------------------------------------------ floor */
  const first = layouts[0];
  const hallW = Math.max(46, first.width + 30);
  const hallD = Math.max(44, first.depth + 32);
  const hall = new THREE.Mesh(
    new THREE.PlaneGeometry(hallW, hallD),
    new THREE.MeshStandardMaterial({ color: 0x2a3833, roughness: 0.94, metalness: 0.02 }),
  );
  hall.rotation.x = -Math.PI / 2;
  hall.position.set(0, 0, -first.depth / 2 + 3);
  scene.add(hall);

  const grid = new THREE.GridHelper(Math.max(hallW, hallD), 44, 0x45605a, 0x33443e);
  grid.position.set(0, 0.012, -first.depth / 2 + 3);
  scene.add(grid);

  /* Working areas: painted floor zones. They are markings, not walls, so they
     never stand between the camera and the racks. */
  const zonePlates = [];
  const addZonePlate = (x, z, w, d, color) => {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, transparent: true, opacity: 0.55 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(x, 0.018, z);
    scene.add(plate);
    zonePlates.push(plate);
  };
  const apronX = first.width / 2 + 5.2;
  addZonePlate(-apronX, 5.4, 8, 6.4, 0x2f423c);
  addZonePlate(apronX, 5.4, 8, 6.4, 0x3a352f);
  addZonePlate(0, 2.0, first.width + 1.6, 2.6, 0x333c2c);

  const floorLabels = [];
  const makeFloorLabel = (text, x, z, width = 3.2, color = 0x9fb0a7) => {
    const label = document.createElement("canvas");
    label.width = 512;
    label.height = 128;
    const ctx = label.getContext("2d");
    if (!ctx) return;
    ctx.font = "600 54px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text).toUpperCase(), 256, 60, 470);
    ctx.fillRect(78, 96, 356, 3);
    const texture = new THREE.CanvasTexture(label);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.05, z);
    mesh.renderOrder = 1;
    return mesh;
  };
  const addFloorLabel = (text, x, z, width = 3.2, color = 0x9fb0a7) => {
    const mesh = makeFloorLabel(text, x, z, width, color);
    scene.add(mesh);
    floorLabels.push(mesh);
  };
  addFloorLabel(sv ? "Inleverans" : "Inbound", -apronX, 6.4, 3.4);
  addFloorLabel(sv ? "Utlastning" : "Outbound", apronX, 6.4, 3.4);
  addFloorLabel(sv ? "Plock" : "Picking", 0, 2.1, 2.8, 0xb9c7b4);

  /* Industry zones move the aisles: cold, chilled, heavy and dry goods are
     grouped in the order the profile defines. The floor label names the zone
     at the first aisle in it, so the 3D layout follows the same profile as the
     analysis. */
  const zoneLabelGroup = new THREE.Group();
  scene.add(zoneLabelGroup);
  const ZONE_COLOR = { frozen: 0xa9c6d8, chilled: 0x9fc4b6, heavy: 0xc8a06a, ambient: 0x9fb0a7, pick: 0xb9c7b4 };
  function applyZoneLabels(next) {
    while (zoneLabelGroup.children.length) {
      const child = zoneLabelGroup.children.pop();
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
    }
    const zones = next.environment?.zones;
    if (!zones || !zones.length) return;
    const seen = new Set();
    for (const frame of next.frames) {
      const aisle = next.environment.aisles.find((entry) => entry.index === frame.rowIndex);
      const zoneLabel = aisle?.zone;
      if (!zoneLabel || seen.has(zoneLabel)) continue;
      seen.add(zoneLabel);
      const zone = zones.find((entry) => entry.label === zoneLabel);
      const mesh = makeFloorLabel(zoneLabel, frame.x, 1.15, Math.min(4.6, ROW_GAP * 1.15), ZONE_COLOR[zone?.tone] ?? 0x9fb0a7);
      mesh.material.opacity = 0.9;
      zoneLabelGroup.add(mesh);
    }
  }

  /* Ceiling luminaires. One instanced call for the whole hall. */
  const lampGeometry = new THREE.PlaneGeometry(1.5, 9);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xe4ece4, transparent: true, opacity: 0.09, side: THREE.DoubleSide });
  const lampRows = 3;
  const lampCols = 4;
  const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, lampRows * lampCols);
  {
    let index = 0;
    for (let row = 0; row < lampRows; row++) {
      for (let col = 0; col < lampCols; col++) {
        dummy.position.set(
          -first.width / 2 + 3 + (col * (first.width - 6)) / Math.max(1, lampCols - 1),
          6.9,
          -first.depth / 2 + 1 + (row * (first.depth + 10)) / Math.max(1, lampRows - 1),
        );
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        lamps.setMatrixAt(index++, dummy.matrix);
      }
    }
    lamps.instanceMatrix.needsUpdate = true;
  }
  dummy.rotation.set(0, 0, 0);
  scene.add(lamps);

  /* ------------------------------------------------------------------ racks */
  const uprights = new THREE.InstancedMesh(uprightGeometry(RACK_HEIGHT), steelMaterial, maxUprights);
  const beams = new THREE.InstancedMesh(beamGeometry(BAY * 0.94), beamMaterial, maxBeams);
  const protectors = new THREE.InstancedMesh(protectorGeometry(), protectorMaterial, maxProtectors);
  uprights.name = "uprights";
  beams.name = "beams";
  protectors.name = "protectors";
  scene.add(uprights, beams, protectors);

  const floorLines = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.012, 1), tapeMaterial, maxLines);
  floorLines.name = "floor-lines";
  scene.add(floorLines);

  /* ---------------------------------------------------------------- pallets */
  const palletMesh = new THREE.InstancedMesh(palletGeometry(), palletMaterial, maxSlots);
  palletMesh.name = "pallets";
  palletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(palletMesh);

  const loadMeshes = {};
  const farLoadMeshes = {};
  for (const pattern of ["smooth", "striped", "dotted"]) {
    const capacity = Math.max(1, maxPattern[pattern] ?? 0);
    const detailed = new THREE.InstancedMesh(loadGeometry(0), detailLoadMaterials[pattern], capacity);
    detailed.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    detailed.name = `load-${pattern}`;
    scene.add(detailed);
    loadMeshes[pattern] = detailed;

    const far = new THREE.InstancedMesh(new THREE.BoxGeometry(0.7, 1, 0.92), farLoadMaterials[pattern], capacity);
    far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    far.name = `far-${pattern}`;
    far.visible = false;
    scene.add(far);
    farLoadMeshes[pattern] = far;
  }

  const shadowMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.6, 12), shadowMaterial, maxSlots);
  shadowMesh.name = "contact-shadows";
  scene.add(shadowMesh);

  /* Status lamps: small beacons above the load. They carry overstock, stockout
     and inactive stock without covering the rack face. */
  const markerGeometry = new THREE.OctahedronGeometry(0.11, 0);
  const markers = {
    overstock: new THREE.InstancedMesh(markerGeometry, new THREE.MeshBasicMaterial({ color: STATUS_COLOR.overstock }), maxSlots),
    inactive: new THREE.InstancedMesh(markerGeometry, new THREE.MeshBasicMaterial({ color: STATUS_COLOR.inactive }), maxSlots),
    stockout: new THREE.InstancedMesh(
      markerGeometry,
      new THREE.MeshBasicMaterial({ color: STATUS_COLOR.stockout, transparent: true, opacity: 0.9 }),
      maxSlots,
    ),
  };
  for (const mesh of Object.values(markers)) {
    mesh.name = "status-markers";
    scene.add(mesh);
  }

  /* --------------------------------------------------------------- conveyor */
  const conveyor = new THREE.Group();
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(12, 0.22, 1.05),
    new THREE.MeshStandardMaterial({ color: 0x42564b, roughness: 0.78, metalness: 0.2 }),
  );
  belt.position.set(-2.4, 0.92, 3.6);
  conveyor.add(belt);
  const beltLegs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.92, 0.12), steelMaterial, 6);
  for (let i = 0; i < 6; i++) {
    dummy.position.set(-7.6 + i * 2.1, 0.46, 3.6);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    beltLegs.setMatrixAt(i, dummy.matrix);
  }
  conveyor.add(beltLegs);
  scene.add(conveyor);

  const flowCount = 16;
  const flow = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.48, 0.32, 0.48),
    new THREE.MeshStandardMaterial({ color: 0xb9a27c, roughness: 0.82 }),
    flowCount,
  );
  flow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(flow);

  const scanner = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 2.4),
    new THREE.MeshBasicMaterial({ color: 0xd9c9a3, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
  );
  scanner.position.set(-2, 2.1, 3.6);
  scene.add(scanner);

  /* Dock bays are marked on the floor as levelling plates with a safety edge.
     Freestanding door frames read as floating black slabs without walls, so the
     apron and the truck carry the goods-in/goods-out story instead. */
  const dockGroup = new THREE.Group();
  for (const x of [-5.4, 0, 5.4]) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.06, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x4d5b56, roughness: 0.55, metalness: 0.45 }),
    );
    plate.position.set(x, 0.03, 7.1);
    dockGroup.add(plate);
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 0.03, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xd9a35f, roughness: 0.75 }),
    );
    edge.position.set(x, 0.06, 5.95);
    dockGroup.add(edge);
  }
  scene.add(dockGroup);

  /* Two low packing tables beside the pick strip. They sit outside the rack
     block, so the aisle view stays open. */
  const benchGroup = new THREE.Group();
  for (const x of [-(first.width / 2 + 1.8), first.width / 2 + 1.8]) {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.1, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x6c7d75, roughness: 0.68, metalness: 0.2 }),
    );
    top.position.set(x, 0.9, 1.4);
    top.userData.baseX = x;
    benchGroup.add(top);
    for (const dx of [-1.05, 1.05]) {
      for (const dz of [-0.34, 0.34]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), steelMaterial);
        leg.position.set(x + dx, 0.45, 1.4 + dz);
        leg.userData.baseX = x;
        benchGroup.add(leg);
      }
    }
  }
  scene.add(benchGroup);

  /* ---------------------------------------------------------------- truck */
  function makeTruck() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 1.2, 2.3),
      new THREE.MeshStandardMaterial({ color: 0xc79a4c, roughness: 0.55, metalness: 0.2 }),
    );
    body.position.y = 0.78;
    group.add(body);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.5, 0.8), steelMaterial);
    mast.position.set(-0.8, 1.45, 0.9);
    group.add(mast);
    const fork = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.08, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x8a9b90, metalness: 0.5, roughness: 0.4 }),
    );
    fork.position.set(-1.2, 0.24, 0.9);
    group.add(fork);
    const wheelGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.2, 10);
    wheelGeometry.rotateX(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2320, roughness: 0.92 });
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.6, 0.6]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.28, z);
        group.add(wheel);
      }
    }
    return group;
  }
  const truck = makeTruck();
  const truckStart = { x: Math.min(6.4, first.width / 2 - 1.6), z: 4.4 };
  truck.position.set(truckStart.x, 0, truckStart.z);
  truck.rotation.y = -0.6;
  scene.add(truck);

  /* ---------------------------------------------------------------- cones */
  const coneGeometry = new THREE.ConeGeometry(0.22, 0.62, 10);
  const cones = new THREE.InstancedMesh(coneGeometry, new THREE.MeshStandardMaterial({ color: 0xc4714a, roughness: 0.82 }), 12);
  const coneStates = [];
  for (let i = 0; i < 12; i++) {
    coneStates.push({ x: -5.5 + (i % 6) * 2.1, z: 4.6 - Math.floor(i / 6) * 1.5, down: 0 });
  }
  scene.add(cones);

  /* -------------------------------------------------------------- forecast */
  const forecastW = Math.max(10, first.width * 0.8);
  const forecast = new THREE.Group();
  const forecastPoints = Array.from({ length: 25 }, (_, i) => new THREE.Vector3(-forecastW / 2 + (i * forecastW) / 24, 6.4, -first.depth * 0.4));
  const forecastLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(forecastPoints),
    new THREE.LineDashedMaterial({ color: 0xe6d7b4, dashSize: 0.32, gapSize: 0.22, transparent: true, opacity: 0.9 }),
  );
  forecastLine.computeLineDistances();
  forecast.add(forecastLine);
  const curveAt = (i) => Math.sin(i * 0.42) * 0.32 + Math.cos(i * 0.17) * 0.16;
  const bandShape = new THREE.Shape();
  bandShape.moveTo(-forecastW / 2, 6.4 + curveAt(0) - 0.18);
  for (let i = 0; i < forecastPoints.length; i++) {
    bandShape.lineTo(-forecastW / 2 + (i * forecastW) / 24, 6.4 + curveAt(i) - 0.18);
  }
  for (let i = forecastPoints.length - 1; i >= 0; i--) {
    bandShape.lineTo(-forecastW / 2 + (i * forecastW) / 24, 6.4 + curveAt(i) + 0.42);
  }
  bandShape.closePath();
  const band = new THREE.Mesh(
    new THREE.ShapeGeometry(bandShape),
    new THREE.MeshBasicMaterial({ color: 0xb9c9bd, transparent: true, opacity: 0.1, side: THREE.DoubleSide }),
  );
  band.position.z = 0.4;
  forecast.add(band);
  forecast.visible = false;
  scene.add(forecast);

  /* --------------------------------------------------------------- layout */
  let environment = data[0];
  let layout = layouts[0];
  let statusBySku = null;
  let act = 0;
  let progress = 0;
  let month = 12;
  let clock = 0;
  let paused = false;
  let disposed = false;
  let explore = false;
  let truckSpeed = 0;
  let detailedLoads = true;
  let lastDetailRadius = -1;
  let currentRow = -1;

  function statusOf(slot) {
    return (statusBySku && statusBySku[slot.sku]) || slot.status || "balanced";
  }

  function loadHeightFor(slot) {
    const boxes = Math.max(1, Math.min(12, Number(slot.boxes) || 1));
    return 0.24 + (boxes / 12) * (LOAD_HEIGHT - 0.24);
  }

  function layoutMarkers() {
    const counts = { overstock: 0, inactive: 0, stockout: 0 };
    layout.slots.forEach((slot) => {
      const status = statusOf(slot);
      if (status === "balanced" || !markers[status]) return;
      dummy.position.set(slot.x, slot.topY + 0.32, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      markers[status].setMatrixAt(counts[status]++, dummy.matrix);
    });
    for (const status of Object.keys(markers)) {
      markers[status].count = counts[status];
      markers[status].visible = counts[status] > 0;
      markers[status].instanceMatrix.needsUpdate = true;
    }
  }

  function applyStatusColors() {
    for (const pattern of ["smooth", "striped", "dotted"]) {
      const mesh = loadMeshes[pattern];
      if (!mesh) continue;
      for (const slot of layout.slots) {
        if (slot.pattern !== pattern) continue;
        mesh.setColorAt(slot.loadIndex, new THREE.Color(STATUS_COLOR[statusOf(slot)] ?? STATUS_COLOR.balanced));
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      const far = farLoadMeshes[pattern];
      if (far && far.instanceColor) {
        for (const slot of layout.slots) {
          if (slot.pattern !== pattern) continue;
          far.setColorAt(slot.loadIndex, new THREE.Color(STATUS_COLOR[statusOf(slot)] ?? STATUS_COLOR.balanced));
        }
        far.instanceColor.needsUpdate = true;
      }
    }
    layoutMarkers();
  }

  function applyLayout(next) {
    layout = next;
    applyZoneLabels(next);
    const cursors = { smooth: 0, striped: 0, dotted: 0 };
    for (const slot of layout.slots) {
      slot.loadIndex = cursors[slot.pattern] ?? (cursors[slot.pattern] = 0);
      cursors[slot.pattern] = slot.loadIndex + 1;
    }

    let uprightIndex = 0;
    let beamIndex = 0;
    let protectorIndex = 0;
    let lineIndex = 0;
    for (const frame of layout.frames) {
      for (let bay = 0; bay <= frame.bays; bay++) {
        const z = frame.z + bay * BAY;
        for (const dx of [-0.62, 0.62]) {
          dummy.position.set(frame.x + dx, 0, z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          if (uprightIndex < uprights.count) uprights.setMatrixAt(uprightIndex++, dummy.matrix);
        }
      }
      for (const z of [frame.z + 0.06, frame.z + frame.bays * BAY - 0.06]) {
        for (const dx of [-0.62, 0.62]) {
          dummy.position.set(frame.x + dx, 0, z);
          dummy.updateMatrix();
          if (protectorIndex < protectors.count) protectors.setMatrixAt(protectorIndex++, dummy.matrix);
        }
      }
      for (let bay = 0; bay < frame.bays; bay++) {
        const z = frame.z + bay * BAY + BAY / 2;
        for (let level = 0; level < frame.levels; level++) {
          for (const dx of [-0.62, 0.62]) {
            dummy.position.set(frame.x + dx, 0.28 + level * LEVEL_H, z);
            dummy.updateMatrix();
            if (beamIndex < beams.count) beams.setMatrixAt(beamIndex++, dummy.matrix);
          }
        }
      }
      for (const dx of [-0.84, 0.84]) {
        dummy.position.set(frame.x + dx, 0.014, frame.z + (frame.bays * BAY) / 2);
        dummy.scale.set(1, 1, frame.bays * BAY);
        dummy.updateMatrix();
        if (lineIndex < floorLines.count) floorLines.setMatrixAt(lineIndex++, dummy.matrix);
      }
      dummy.scale.set(1, 1, 1);
    }
    uprights.count = uprightIndex;
    beams.count = beamIndex;
    protectors.count = protectorIndex;
    floorLines.count = lineIndex;
    uprights.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    protectors.instanceMatrix.needsUpdate = true;
    floorLines.instanceMatrix.needsUpdate = true;

    let shadowIndex = 0;
    let palletIndex = 0;
    for (const slot of layout.slots) {
      const height = loadHeightFor(slot);
      const baseY = 0.3 + slot.level * LEVEL_H;
      slot.loadHeight = height;
      slot.topY = baseY + PALLET.h + height;

      dummy.position.set(slot.x, baseY + 0.004, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      palletMesh.setMatrixAt(palletIndex++, dummy.matrix);

      dummy.position.set(slot.x, baseY + 0.004, slot.z);
      dummy.rotation.set(0, (slot.level + slot.side) % 2 === 1 ? Math.PI : 0, 0);
      dummy.scale.set(1, Math.max(0.2, height / 0.8), 1);
      dummy.updateMatrix();
      loadMeshes[slot.pattern]?.setMatrixAt(slot.loadIndex, dummy.matrix);

      dummy.position.set(slot.x, baseY + PALLET.h + height / 2, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, Math.max(0.05, height), 1);
      dummy.updateMatrix();
      farLoadMeshes[slot.pattern]?.setMatrixAt(slot.loadIndex, dummy.matrix);

      dummy.position.set(slot.x, 0.03, slot.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(1.28, 1, 1);
      dummy.updateMatrix();
      shadowMesh.setMatrixAt(shadowIndex++, dummy.matrix);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
    }
    palletMesh.count = layout.slots.length;
    palletMesh.instanceMatrix.needsUpdate = true;
    stats.pallets = layout.slots.length;
    shadowMesh.count = shadowIndex;
    shadowMesh.instanceMatrix.needsUpdate = true;
    for (const pattern of ["smooth", "striped", "dotted"]) {
      const count = cursors[pattern] ?? 0;
      loadMeshes[pattern].count = count;
      farLoadMeshes[pattern].count = count;
      loadMeshes[pattern].visible = count > 0 && detailedLoads;
      farLoadMeshes[pattern].visible = count > 0 && !detailedLoads;
      loadMeshes[pattern].instanceMatrix.needsUpdate = true;
      farLoadMeshes[pattern].instanceMatrix.needsUpdate = true;
    }
    applyDetailLevel(view.radius);
    applyStatusColors();

    // Working areas and floor paint follow the current hall width.
    const half = layout.width / 2;
    zonePlates[0]?.position.set(-half - 5.2, 0.018, 5.4);
    zonePlates[1]?.position.set(half + 5.2, 0.018, 5.4);
    zonePlates[2]?.position.set(0, 0.018, 2.0);
    floorLabels[0]?.position.set(-half - 5.2, 0.05, 6.4);
    floorLabels[1]?.position.set(half + 5.2, 0.05, 6.4);
    benchGroup.children.forEach((child) => {
      const base = child.userData.baseX;
                    if (base) child.position.x = Math.sign(base) * (half + 1.8);
    });
  }

  /* ------------------------------------------------------------ camera rig */
  const span = Math.max(first.width, first.depth);
  const overviewTarget = new THREE.Vector3(0, 1.9, -first.depth * 0.34);
  const view = {
    radius: Math.max(20, span * 0.7),
    theta: 0.58,
    phi: 1.06,
    target: overviewTarget.clone(),
    goal: {
      radius: Math.max(20, span * 0.7),
      theta: 0.58,
      phi: 1.06,
      target: overviewTarget.clone(),
    },
  };
  const clampRadius = (value) => Math.min(150, Math.max(10, value));
  const clampTarget = (target) => {
    target.x = Math.min(layout.width / 2 + 5, Math.max(-layout.width / 2 - 5, target.x));
    target.z = Math.min(10, Math.max(-layout.depth - 5, target.z));
    target.y = Math.min(5, Math.max(0.9, target.y));
    return target;
  };
  view.radius = clampRadius(view.radius);
  view.goal.radius = view.radius;

  const overview = { radius: view.radius, theta: 0.58, phi: 1.06, target: overviewTarget.clone() };

  /** Story keyframes: import, analysis, forecast, act. */
  function storyKeys() {
    const d = layout.depth;
    return [
      { radius: Math.max(18, layout.width * 0.56), theta: 0.3, phi: 1.14, target: new THREE.Vector3(0, 2.0, 2.4) },
      { radius: Math.max(23, layout.width * 0.78), theta: 0.5, phi: 0.96, target: new THREE.Vector3(-1, 2.5, -d * 0.36) },
      { radius: Math.max(26, layout.width * 0.9), theta: 0.38, phi: 0.6, target: new THREE.Vector3(0, 2.8, -d * 0.3) },
      { radius: Math.max(23, layout.width * 0.82), theta: 0.92, phi: 1.02, target: new THREE.Vector3(0, 2.0, -d * 0.28) },
    ];
  }

  function applyStoryGoal(p) {
    const keys = storyKeys();
    const index = Math.min(3, Math.floor(p * 4));
    const next = Math.min(3, index + 1);
    const raw = Math.min(1, Math.max(0, p * 4 - index));
    const t = raw * raw * (3 - 2 * raw);
    const a = keys[index];
    const b = keys[next];
    view.goal.radius = clampRadius(a.radius + (b.radius - a.radius) * t);
    view.goal.theta = a.theta + (b.theta - a.theta) * t;
    view.goal.phi = a.phi + (b.phi - a.phi) * t;
    view.goal.target.copy(a.target).lerp(b.target, t);
  }

  function easeView(dt) {
    const k = Math.min(1, dt * 4.2);
    view.radius += (view.goal.radius - view.radius) * k;
    view.theta += (view.goal.theta - view.theta) * k;
    view.phi += (view.goal.phi - view.phi) * k;
    view.target.lerp(view.goal.target, k);
    clampTarget(view.target);
    const sinPhi = Math.sin(view.phi);
    camera.position.set(
      view.target.x + view.radius * sinPhi * Math.sin(view.theta),
      view.target.y + view.radius * Math.cos(view.phi),
      view.target.z + view.radius * sinPhi * Math.cos(view.theta),
    );
    camera.lookAt(view.target);
  }

  function setView(next, free = true) {
    if (next === "overview") {
      Object.assign(view.goal, {
        radius: overview.radius,
        theta: overview.theta,
        phi: overview.phi,
      });
      view.goal.target.copy(overviewTarget);
    } else {
      if (next.radius !== undefined) view.goal.radius = clampRadius(next.radius);
      if (next.theta !== undefined) view.goal.theta = next.theta;
      if (next.phi !== undefined) view.goal.phi = Math.min(1.42, Math.max(0.25, next.phi));
      if (next.target) view.goal.target.copy(next.target);
    }
    if (free) freeLook = true;
  }

  /* Zoom and row stepping both end in the same eased goal, so a click can never
     snap the camera into a rack. */
  function zoomBy(factor) {
    view.goal.radius = clampRadius(view.goal.radius * factor);
    freeLook = true;
    staticRefresh();
  }

  function stepRow(direction) {
    if (!layout.frames.length) return;
    currentRow = currentRow < 0 ? (direction >= 0 ? 0 : layout.frames.length - 1) : (currentRow + direction + layout.frames.length) % layout.frames.length;
    const frame = layout.frames[currentRow];
    // Look down the aisle between two rows, from the dock side, so the depth of
    // the racking is what the reader sees rather than a row seen side-on.
    const neighbour = layout.frames[currentRow + 1] ?? layout.frames[currentRow - 1];
    const aisleX = neighbour ? (frame.x + neighbour.x) / 2 : frame.x;
    setView({
      target: new THREE.Vector3(aisleX, 1.8, -layout.depth * 0.55),
      radius: Math.max(13, layout.depth * 1.55),
      theta: 0.02,
      phi: 1.3,
    });
    if (aisleLabel) aisleLabel.textContent = sv ? `Gång ${frame.label}` : `Aisle ${frame.label}`;
    staticRefresh();
  }

  function resetView() {
    freeLook = false;
    currentRow = -1;
    if (aisleLabel) aisleLabel.textContent = sv ? "Översikt" : "Overview";
    applyStoryGoal(progress);
    staticRefresh();
  }

  const aisleLabel = root.querySelector("[data-world-aisle]");

  /* --------------------------------------------------------------- input */
  let freeLook = false;
  let dragging = null;
  let moved = false;
  const activePointers = new Map();
  let pinch = null;

  function panBy(dx, dy, scale = view.radius * 0.0015) {
    const right = new THREE.Vector3(Math.cos(view.theta), 0, -Math.sin(view.theta));
    const forward = new THREE.Vector3(-Math.sin(view.theta), 0, -Math.cos(view.theta));
    view.goal.target.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale);
    clampTarget(view.goal.target);
    freeLook = true;
  }

  const onPointerDown = (event) => {
    if (explore) return;
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      dragging = null;
      return;
    }
    canvas.setPointerCapture?.(event.pointerId);
    dragging = {
      x: event.clientX,
      y: event.clientY,
      pan: event.button === 2 || event.button === 1 || event.shiftKey,
      touch: event.pointerType === "touch",
    };
    moved = false;
    freeLook = true;
  };
  const onPointerMove = (event) => {
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 8 && pinch.distance > 8) {
        view.goal.radius = clampRadius(view.goal.radius * (pinch.distance / distance));
      }
      panBy((a.x + b.x) / 2 - pinch.midX, (a.y + b.y) / 2 - pinch.midY);
      pinch = { distance, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      moved = true;
      return;
    }
    if (!dragging) return;
    const dx = event.clientX - dragging.x;
    const dy = event.clientY - dragging.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    dragging.x = event.clientX;
    dragging.y = event.clientY;
    if (dragging.pan) {
      panBy(dx, dy);
      return;
    }
    view.goal.theta -= dx * 0.0055;
    // A vertical swipe on a phone belongs to the page, not the camera.
    if (!dragging.touch) {
      view.goal.phi = Math.min(1.42, Math.max(0.25, view.goal.phi - dy * 0.004));
    }
    canvas.style.cursor = "grabbing";
  };
  const endPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    if (activePointers.size === 0) {
      dragging = null;
      canvas.style.cursor = "";
    }
  };
  const onWheel = (event) => {
    if (explore) return;
    // Trackpad pinch is delivered as ctrl+wheel. Only that gesture zooms, so a
    // normal wheel still scrolls the page through the story.
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomBy(Math.exp(event.deltaY * 0.0028));
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  const buttons = {
    reset: root.querySelector("[data-world-cam-reset]"),
    zoomIn: root.querySelector("[data-world-zoom-in]"),
    zoomOut: root.querySelector("[data-world-zoom-out]"),
    prev: root.querySelector("[data-world-row-prev]"),
    next: root.querySelector("[data-world-row-next]"),
  };
  const onReset = () => resetView();
  const onZoomIn = () => zoomBy(1 / 1.22);
  const onZoomOut = () => zoomBy(1.22);
  const onPrev = () => stepRow(-1);
  const onNext = () => stepRow(1);
  buttons.reset?.addEventListener("click", onReset);
  buttons.zoomIn?.addEventListener("click", onZoomIn);
  buttons.zoomOut?.addEventListener("click", onZoomOut);
  buttons.prev?.addEventListener("click", onPrev);
  buttons.next?.addEventListener("click", onNext);

  /* --------------------------------------------------------------- explore */
  const player = { x: truckStart.x, z: truckStart.z, angle: 0, speed: 0 };
  const keys = new Set();
  const onKeyDown = (event) => {
    if (!explore) return;
    if (event.key === "Escape") {
      stopExplore();
      return;
    }
    const key = event.key.toLowerCase();
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) {
      keys.add(key);
      event.preventDefault();
    }
  };
  const onKeyUp = (event) => keys.delete(event.key.toLowerCase());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  function updateExplore(dt) {
    const input = {
      forward: (keys.has("w") || keys.has("arrowup") ? 1 : 0) - (keys.has("s") || keys.has("arrowdown") ? 1 : 0),
      turn: (keys.has("a") || keys.has("arrowleft") ? 1 : 0) - (keys.has("d") || keys.has("arrowright") ? 1 : 0),
    };
    Object.assign(player, stepTruck(player, input, dt));
    truckSpeed = player.speed;
    truck.position.set(player.x, 0, player.z);
    truck.rotation.y = player.angle;
    stats.player = [Math.round(player.x * 100) / 100, Math.round(player.z * 100) / 100];

    camera.position.set(player.x - Math.sin(player.angle) * 5.4, 3.15, player.z + Math.cos(player.angle) * 5.4);
    camera.lookAt(player.x + Math.sin(player.angle) * 4, 1.25, player.z - Math.cos(player.angle) * 4);

    for (const index of knockedCones(coneStates, player.x, player.z)) coneStates[index].down = performance.now();
  }

  function showToast(text) {
    const toast = root.querySelector("[data-world-toast]");
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
  }

  function startExplore() {
    if (reduced) {
      showToast(sv ? "Utforska-läget är avstängt när animationer är pausade." : "Explore is off while animations are paused.");
      return;
    }
    explore = true;
    freeLook = true;
    stats.mode = "explore";
    player.x = truck.position.x;
    player.z = truck.position.z;
    player.angle = truck.rotation.y;
    truckSpeed = 0;
    root.dataset.worldMode = "explore";
    root.querySelector("[data-world-explore]")?.setAttribute("aria-pressed", "true");
    const exit = root.querySelector("[data-world-exit]");
    if (exit) exit.hidden = false;
    root.querySelector("[data-world-stage]")?.classList.add("is-explore");
    showToast(sv ? "WASD eller piltangenter. Esc lämnar läget." : "WASD or arrow keys. Esc leaves the mode.");
  }

  function stopExplore() {
    explore = false;
    stats.mode = "story";
    truckSpeed = 0;
    keys.clear();
    delete root.dataset.worldMode;
    root.querySelector("[data-world-explore]")?.setAttribute("aria-pressed", "false");
    const exit = root.querySelector("[data-world-exit]");
    if (exit) exit.hidden = true;
    root.querySelector("[data-world-stage]")?.classList.remove("is-explore");
    const toast = root.querySelector("[data-world-toast]");
    if (toast) toast.hidden = true;
    truck.position.set(truckStart.x, 0, truckStart.z);
    truck.rotation.y = -0.6;
    freeLook = false;
    applyStoryGoal(progress);
  }

  /* ----------------------------------------------------------------- stats */
  const stats = {
    drawCalls: 0,
    triangles: 0,
    programs: 0,
    fps: 0,
    dpr: 1,
    act: 0,
    environment: environment.id,
    mode: "story",
    reduced,
    webgl: hasWebgl,
    rows: first.rowCount,
    pallets: 0,
  };

  /* ------------------------------------------------------------------ view */
  function resize() {
    if (!renderer) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = effectiveDpr(quality, window.devicePixelRatio || 1, coarse);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    stats.dpr = dpr;
  }

  // Full kvalitet (nivå 2 i perf.ts) är startvärdet; dprLevel 1 motsvarade
  // samma upplösning innan beräkningen flyttades till effectiveDpr.
  let quality = 2;
  let last = performance.now();
  let frameCount = 0;
  let frameTimeSum = 0;
  let fps = 0;

  function applyDetailLevel(radius) {
    const threshold = Math.max(34, span * 0.72);
    const detailed = radius < threshold;
    if (detailed === detailedLoads && Math.abs(radius - lastDetailRadius) < 4) return;
    detailedLoads = detailed;
    lastDetailRadius = radius;
    for (const pattern of ["smooth", "striped", "dotted"]) {
      const count = loadMeshes[pattern].count;
      loadMeshes[pattern].visible = count > 0 && detailed;
      farLoadMeshes[pattern].visible = count > 0 && !detailed;
    }
  }

  function applyProgress(p) {
    progress = Math.min(1, Math.max(0, p));
    const nextAct = Math.min(3, Math.floor(progress * 4));
    if (nextAct !== act) {
      act = nextAct;
      stats.act = act;
    }
    if (!freeLook) applyStoryGoal(progress);
    stats.progress = Math.round(progress * 1000) / 1000;
    conveyor.visible = act <= 1;
    scanner.visible = act === 0;
    forecast.visible = act === 2 || act === 3;
  }

  /** Reduced motion has no loop; a control click still needs one fresh frame. */
  function staticRefresh() {
    if (!reduced || !renderer) return;
    easeView(1);
    renderFrame(performance.now());
  }

  function updateFlow(dt) {
    if (act !== 0) {
      flow.visible = false;
      return;
    }
    flow.visible = true;
    const speed = 2.0 + (month / 12) * 3.0;
    for (let i = 0; i < flowCount; i++) {
      const x = -8.4 + ((clock * speed + (i / flowCount) * 12) % 12);
      dummy.position.set(x, 1.2, 3.6);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      flow.setMatrixAt(i, dummy.matrix);
    }
    flow.instanceMatrix.needsUpdate = true;
    scanner.position.x = -8.4 + ((clock * 1.5) % 12);
  }

  function updateCones() {
    if (!explore) return;
    const now = performance.now();
    for (let i = 0; i < coneStates.length; i++) {
      const cone = coneStates[i];
      if (cone.down && now - cone.down > CONE_RESET_MS) cone.down = 0;
      dummy.position.set(cone.x, cone.down ? 0.22 : 0.32, cone.z);
      dummy.rotation.set(cone.down ? Math.PI / 2 : 0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      cones.setMatrixAt(i, dummy.matrix);
    }
    cones.instanceMatrix.needsUpdate = true;
  }

  function renderFrame(now) {
    if (disposed || paused) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;

    if (explore) {
      updateExplore(dt);
    } else {
      if (!freeLook) applyStoryGoal(progress);
      easeView(dt);
    }

    updateFlow(dt);
    updateCones();
    applyDetailLevel(view.radius);

    const phase = (clock * STOCKOUT_PULSE_HZ) % 1;
    markers.stockout.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2));
    if (!explore && act === 3) truck.position.z = truckStart.z + Math.sin(clock * 0.55) * 0.35;

    if (renderer) {
      renderer.render(scene, camera);
      const info = renderer.info.render;
      stats.drawCalls = info.calls;
      stats.triangles = info.triangles;
      stats.programs = renderer.info.programs?.length ?? 0;
      stats.camera = [
        Math.round(camera.position.x * 10) / 10,
        Math.round(camera.position.y * 10) / 10,
        Math.round(camera.position.z * 10) / 10,
      ];
    }
    if (onStats && frameCount % 30 === 0) onStats({ ...stats, fps });
  }

  function loop(now) {
    if (disposed) return;
    requestAnimationFrame(loop);
    if (paused) {
      last = now;
      return;
    }
    const frameMs = now - last;
    frameTimeSum += frameMs;
    frameCount++;
    if (frameCount % 30 === 0) {
      fps = Math.round(1000 / (frameTimeSum / 30));
      frameTimeSum = 0;
      stats.fps = fps;
      // Kvalitetsnivån och DPR-skalan kommer från perf.ts; nivå 2 är full upplösning.
      if (fps < 45 && quality > 0) {
        quality -= 1;
        resize();
      } else if (fps > 56 && quality < 2) {
        quality += 1;
        resize();
      }
    }
    renderFrame(now);
  }

  /* ------------------------------------------------------------ lifecycle */
  const listeners = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };

  if (renderer) {
    resize();
    applyLayout(layouts[0]);
    resize();
    applyStoryGoal(reduced ? 0.36 : 0);
    easeView(1);
    renderFrame(performance.now());
    if (!reduced) requestAnimationFrame(loop);
  }

  on(window, "resize", resize);
  on(document, "visibilitychange", () => {
    paused = document.hidden;
  });
  const gateObserver =
    "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            for (const entry of entries) paused = !entry.isIntersecting || document.hidden;
          },
          { rootMargin: "120px" },
        )
      : null;
  gateObserver?.observe(canvas);

  function dispose() {
    disposed = true;
    gateObserver?.disconnect();
    listeners.forEach((off) => off());
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", endPointer);
    canvas.removeEventListener("pointercancel", endPointer);
    canvas.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    buttons.reset?.removeEventListener("click", onReset);
    buttons.zoomIn?.removeEventListener("click", onZoomIn);
    buttons.zoomOut?.removeEventListener("click", onZoomOut);
    buttons.prev?.removeEventListener("click", onPrev);
    buttons.next?.removeEventListener("click", onNext);
    renderer?.dispose();
  }

  function applyStatuses(map) {
    statusBySku = map;
    applyStatusColors();
    if (renderer && reduced) renderFrame(performance.now());
  }

  return {
    setProgress: (p) => {
      if (explore) return;
      // Scrolling to another act hands control back to the story camera.
      const nextAct = Math.min(3, Math.floor(Math.min(1, Math.max(0, p)) * 4));
      if (nextAct !== act) {
        freeLook = false;
        currentRow = -1;
        if (aisleLabel) aisleLabel.textContent = sv ? "Översikt" : "Overview";
      }
      applyProgress(p);
      if (renderer && reduced) {
        easeView(1);
        renderFrame(performance.now());
      }
    },
    setEnvironment: (next, statusOverride) => {
      const nextLayout = layouts.find((entry) => entry.id === next.id);
      if (!nextLayout) return;
      environment = next;
      statusBySku = statusOverride ?? null;
      currentRow = -1;
      applyLayout(nextLayout);
      stats.environment = next.id;
      stats.rows = nextLayout.rowCount;
      stats.pallets = nextLayout.slots.length;
      if (aisleLabel) aisleLabel.textContent = sv ? "Översikt" : "Overview";
      freeLook = false;
      const latestSpan = Math.max(nextLayout.width, nextLayout.depth);
      overview.radius = Math.max(20, latestSpan * 0.7);
      overview.target.set(0, 1.9, -nextLayout.depth * 0.34);
      applyStoryGoal(progress);
      if (renderer && reduced) {
        easeView(1);
        renderFrame(performance.now());
      }
    },
    setStatuses: applyStatuses,
    setMonth: (value) => {
      month = Math.min(12, Math.max(1, Number(value) || 12));
    },
    startExplore,
    stopExplore,
    isExplore: () => explore,
    resize,
    stats: () => ({ ...stats }),
    dispose,
  };
}

/* ---------------------------------------------------------------- textures */
/** Carton board with the XYZ pattern printed over it. */
function makeLoadTextures() {
  const build = (kind) => {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 128;
    textureCanvas.height = 128;
    const ctx = textureCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#cbb28c";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2200; i++) {
      const shade = 196 + ((i * 29) % 26);
      ctx.fillStyle = `rgba(${shade},${shade - 14},${shade - 32},0.45)`;
      ctx.fillRect((i * 61) % 128, (i * 43) % 128, 1, 1);
    }
    ctx.strokeStyle = "rgba(120,104,80,.2)";
    ctx.lineWidth = 1;
    for (let y = 7; y < 128; y += 9) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(238,232,214,.42)";
    ctx.fillRect(0, 55, 128, 15);
    if (kind === "striped") {
      ctx.strokeStyle = "rgba(54,66,58,.1)";
      ctx.lineWidth = 6;
      for (let x = -128; x < 256; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 128);
        ctx.lineTo(x + 128, 0);
        ctx.stroke();
      }
    } else if (kind === "dotted") {
      ctx.fillStyle = "rgba(54,66,58,.2)";
      for (let y = 14; y < 128; y += 34) {
        for (let x = 14; x < 128; x += 34) {
          ctx.beginPath();
          ctx.arc(x + ((y / 34) % 2) * 10, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  return { smooth: build("smooth"), striped: build("striped"), dotted: build("dotted") };
}

/** Load faces at overview distance: paper with the XYZ pattern. */
function makePatternTextures() {
  const build = (kind) => {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 128;
    textureCanvas.height = 128;
    const ctx = textureCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#f3ede2";
    ctx.fillRect(0, 0, 128, 128);
    if (kind === "striped") {
      ctx.strokeStyle = "rgba(38,48,42,.5)";
      ctx.lineWidth = 7;
      for (let x = -128; x < 256; x += 26) {
        ctx.beginPath();
        ctx.moveTo(x, 128);
        ctx.lineTo(x + 128, 0);
        ctx.stroke();
      }
    } else if (kind === "dotted") {
      ctx.fillStyle = "rgba(38,48,42,.45)";
      for (let y = 12; y < 128; y += 26) {
        for (let x = 12; x < 128; x += 26) {
          ctx.beginPath();
          ctx.arc(x + ((y / 26) % 2) * 8, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.strokeStyle = "rgba(38,48,42,.12)";
      ctx.lineWidth = 2;
      for (let y = 10; y < 128; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(128, y);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  return { smooth: build("smooth"), striped: build("striped"), dotted: build("dotted") };
}
