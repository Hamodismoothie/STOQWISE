/**
 * Live Warehouse 2.0: signed-in renderer.
 *
 * Draws exactly the layout the server computed (`ui/live-warehouse.ts`):
 * zones, rack frames, pallets with a fill grade, pick faces, docks, conveyors
 * and the article statuses from the analysis. No figure is invented here; the
 * simulation only moves stock between the same numbers and reports the change
 * back to the table.
 *
 * Performance: every repeated object is an InstancedMesh (uprights, beams,
 * pallets, cartons, hits, heat columns, beacons), the scene pauses when hidden
 * or scrolled out of view, and the renderer caps the pixel ratio.
 */
import * as THREE from "/vendor/three/three.module.js";
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
const RACK_TOP = 6.0;
const STATUS_COLOR = {
  balanced: 0xb9c7b4,
  overstock: 0xd9a35f,
  stockout: 0xc96a5c,
  inactive: 0x767f7a,
};
const ABC_COLOR = { A: 0xd9a35f, B: 0x9fb8a8, C: 0x74837c };
const HEAT_STOPS = [0x4f6f5f, 0x8fae7f, 0xd9c07a, 0xd9a35f, 0xb0453a];
const DIM = 0x2f3a35;

export function createAppWorld({
  canvas,
  model,
  locale = "sv",
  statusBySku,
  onSelect,
  onStock,
  onMode,
  onVisibility,
  onExpandCluster,
}) {
  const sv = locale !== "en";
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stage = canvas.parentElement;
  const softwareGl = (() => {
    try {
      const probe = document.createElement("canvas");
      const gl = probe.getContext("webgl2") || probe.getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      const rendererName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      return /swiftshader|llvmpipe|software/i.test(rendererName);
    } catch {
      return false;
    }
  })();
  // Large aggregate scenes are fill-rate bound. MSAA on a full software
  // framebuffer costs more than it adds to box geometry; smaller scenes keep it.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !softwareGl,
    powerPreference: "high-performance",
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1512);
  scene.fog = new THREE.FogExp2(0x0d1512, 0.003);
  const sceneSpan = Math.max(model.floor.w, model.floor.d);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.4, Math.max(420, sceneSpan * 3));
  scene.fog = new THREE.FogExp2(0x0d1512, sceneSpan > 120 ? 0.0011 : 0.003);

  scene.add(new THREE.HemisphereLight(0xeaf2ec, 0x111a17, 1.5));
  const key = new THREE.DirectionalLight(0xfff1da, 2.7);
  key.position.set(-38, 52, 30);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x9db8c6, 0.85);
  fill.position.set(42, 22, -34);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));

  /* ------------------------------------------------------------- articles */
  const slots = model.slots || [];
  const picks = model.picks || [];
  const slotBySku = new Map();
  slots.forEach((slot, index) => {
    slot.index = index;
    slot.stock = Number.isFinite(slot.stock) ? slot.stock : 0;
    slot.pallets = Number.isFinite(slot.pallets) ? slot.pallets : 0;
    slot.fill = Number.isFinite(slot.fill) ? slot.fill : 0;
    slot.status = (statusBySku && statusBySku[slot.sku]) || slot.status;
    slotBySku.set(slot.sku, slot);
  });
  const pickBySku = new Map();
  picks.forEach((pick, index) => {
    pick.index = index;
    pickBySku.set(pick.sku, pick);
  });
  const initialStock = new Map(slots.map((slot) => [slot.sku, slot.stock]));

  const unit = (() => {
    const positive = slots.map((slot) => slot.stock).filter((stock) => stock > 0).sort((a, b) => a - b);
    if (!positive.length) return 1;
    const p75 = positive[Math.floor((positive.length - 1) * 0.75)] ?? positive[positive.length - 1];
    return Math.max(1, Math.round(p75 / 3));
  })();

  const totalCartons = Math.max(1, picks.reduce((sum, pick) => sum + (pick.cartons || 0), 0));
  const totalHits = Math.max(1, slots.length);

  /* ------------------------------------------------------------ materials */
  const patternTextures = makePatternTextures();
  const loadMaterials = {
    smooth: new THREE.MeshStandardMaterial({ map: patternTextures.smooth, roughness: 0.82, metalness: 0.02 }),
    striped: new THREE.MeshStandardMaterial({ map: patternTextures.striped, roughness: 0.82, metalness: 0.02 }),
    dotted: new THREE.MeshStandardMaterial({ map: patternTextures.dotted, roughness: 0.82, metalness: 0.02 }),
  };
  const boardTexture = cardboardTexture(1);
  const timberTexture = woodTexture(2);
  const palletMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: timberTexture ?? null,
    roughness: 0.88,
    metalness: 0.02,
  });
  // Neutral grain so the per-instance status colour still sets the hue.
  const cartonMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: boardTexture ?? null,
    roughness: 0.86,
    metalness: 0.01,
  });
  const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x5d6f68, roughness: 0.52, metalness: 0.45 });
  // Racking beams are painted steel: a warmer, glossier finish than the uprights.
  const beamMaterial = new THREE.MeshStandardMaterial({ color: 0xc07d3e, roughness: 0.42, metalness: 0.4 });
  const protectorMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a34a, roughness: 0.6, metalness: 0.2 });
  const dimMaterial = new THREE.MeshStandardMaterial({ color: 0x3f4a45, roughness: 0.9 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x050a08, transparent: true, opacity: 0.28, depthWrite: false });
  const shadowMesh = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.62, 12),
    shadowMaterial,
    Math.max(1, slots.length),
  );
  scene.add(shadowMesh);
  const shadowDummy = new THREE.Object3D();
  slots.forEach((slot, index) => {
    shadowDummy.position.set(slot.x, 0.028, slot.z);
    shadowDummy.rotation.set(-Math.PI / 2, 0, 0);
    // Footprint of a pallet position rather than a round dot.
    shadowDummy.scale.set(1.3, 1.02, 1);
    shadowDummy.updateMatrix();
    shadowMesh.setMatrixAt(index, shadowDummy.matrix);
  });
  shadowMesh.instanceMatrix.needsUpdate = true;
  shadowMesh.visible = slots.length > 0;

  /* ---------------------------------------------------------------- floor */
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(model.floor.w + 32, model.floor.d + 26),
    new THREE.MeshStandardMaterial({ color: 0x202c27, roughness: 0.96, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(model.floor.w + 20, 40, 0x38504a, 0x2a3a35);
  grid.position.y = 0.012;
  scene.add(grid);

  /* Ceiling luminaires and contact shadows. Both are one instanced draw call
     each and give the hall depth: without them the racks read as floating
     boxes on a flat grid. */
  const lampGeometry = new THREE.PlaneGeometry(1.4, 10);
  const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xe4ece4, transparent: true, opacity: 0.085, side: THREE.DoubleSide });
  const lampRows = Math.max(2, Math.min(4, Math.round(model.floor.d / 18)));
  const lampColumns = Math.max(3, Math.min(6, Math.round(model.floor.w / 24)));
  const lamps = new THREE.InstancedMesh(lampGeometry, lampMaterial, lampRows * lampColumns);
  {
    const lampDummy = new THREE.Object3D();
    let index = 0;
    for (let row = 0; row < lampRows; row++) {
      for (let col = 0; col < lampColumns; col++) {
        lampDummy.position.set(
          -model.floor.w / 2 + 10 + (col * (model.floor.w - 20)) / Math.max(1, lampColumns - 1),
          8.4,
          -model.floor.d / 2 + 8 + (row * (model.floor.d - 16)) / Math.max(1, lampRows - 1),
        );
        lampDummy.rotation.set(-Math.PI / 2, 0, 0);
        lampDummy.updateMatrix();
        lamps.setMatrixAt(index++, lampDummy.matrix);
      }
    }
    lamps.instanceMatrix.needsUpdate = true;
  }
  scene.add(lamps);

  const zoneColors = {
    inbound: 0x2a3a3c,
    storage: 0x28332e,
    picking: 0x333c2c,
    packing: 0x2a3a32,
    outbound: 0x3a3530,
    inactive: 0x303633,
  };
  for (const zone of model.zones) {
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.w, zone.d),
      new THREE.MeshStandardMaterial({ color: zoneColors[zone.id] ?? 0x1a2320, roughness: 1, transparent: true, opacity: 0.92 }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(zone.x, 0.02, zone.z);
    scene.add(plate);
    const border = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-zone.w / 2, 0, -zone.d / 2),
        new THREE.Vector3(zone.w / 2, 0, -zone.d / 2),
        new THREE.Vector3(zone.w / 2, 0, zone.d / 2),
        new THREE.Vector3(-zone.w / 2, 0, zone.d / 2),
      ]),
      new THREE.LineBasicMaterial({ color: 0x3c4d45, transparent: true, opacity: 0.85 }),
    );
    border.position.set(zone.x, 0.04, zone.z);
    scene.add(border);
    // Zone titles lie flat on the floor. A billboard at eye height sat right in
    // front of the racks and hid the interior as soon as the camera entered the
    // zone; floor paint identifies the area without ever occluding it.
    if (zone.id !== "storage") {
      addFloorLabel(zone.label, zone.x, zone.z - zone.d / 2 + 1.5, Math.min(6, Math.max(2.6, zone.w * 0.42)));
    }
  }

  /* --------------------------------------------------------------- racks
     Selective pallet racking: uprights with foot plates, orange step beams on
     every level and yellow protectors at the aisle ends. All three are one
     InstancedMesh each, so the detail costs three draw calls. */
  const frames = model.frames || [];
  const uprightCount = frames.reduce((sum, frame) => sum + (frame.bays + 1) * 2, 0);
  const uprights = new THREE.InstancedMesh(uprightGeometry(RACK_TOP), steelMaterial, Math.max(1, uprightCount));
  const beamCount = frames.reduce((sum, frame) => sum + frame.bays * frame.levels * 2, 0);
  const beams = new THREE.InstancedMesh(beamGeometry(BAY * 0.94), beamMaterial, Math.max(1, beamCount));
  uprights.name = "uprights";
  beams.name = "beams";
  scene.add(uprights, beams);
  const protectorCount = frames.reduce((sum, frame) => sum + (frame.band === "pick" ? 0 : 2), 0);
  const protectors = new THREE.InstancedMesh(protectorGeometry(), protectorMaterial, Math.max(1, protectorCount));
  scene.add(protectors);

  const dummy = new THREE.Object3D();
  let uprightIndex = 0;
  let beamIndex = 0;
  let protectorIndex = 0;
  for (const frame of frames) {
    if (frame.band === "pick") continue;
    for (let bay = 0; bay <= frame.bays; bay++) {
      const z = frame.z + bay * BAY;
      for (const dx of [-0.62, 0.62]) {
        dummy.position.set(frame.x + dx, 0, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        uprights.setMatrixAt(uprightIndex++, dummy.matrix);
      }
    }
    for (const z of [frame.z + 0.05, frame.z + frame.bays * BAY - 0.05]) {
      for (const dx of [-0.62, 0.62]) {
        dummy.position.set(frame.x + dx, 0, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        if (protectorIndex < protectors.count) protectors.setMatrixAt(protectorIndex++, dummy.matrix);
      }
    }
    for (let bay = 0; bay < frame.bays; bay++) {
      const z = frame.z + bay * BAY + BAY / 2;
      for (let level = 0; level < frame.levels; level++) {
        const y = 0.28 + level * LEVEL_H;
        for (const dx of [-0.62, 0.62]) {
          dummy.position.set(frame.x + dx, y, z);
          dummy.updateMatrix();
          if (beamIndex < beams.count) beams.setMatrixAt(beamIndex++, dummy.matrix);
        }
      }
    }
  }
  uprights.count = uprightIndex;
  beams.count = beamIndex;
  protectors.count = protectorIndex;

  /* Aisle floor tape: a painted guide line down both sides of every rack row.
     One instanced mesh, so the whole floor marking costs a single draw call. */
  const tapeRows = frames.filter((frame) => frame.band !== "pick");
  const floorLines = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.09, 0.012, 1),
    new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.92, metalness: 0 }),
    Math.max(1, tapeRows.length * 2),
  );
  floorLines.name = "floor-lines";
  let lineIndex = 0;
  for (const frame of tapeRows) {
    const length = frame.bays * BAY;
    for (const dx of [-0.84, 0.84]) {
      dummy.position.set(frame.x + dx, 0.012, frame.z + length / 2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, length);
      dummy.updateMatrix();
      if (lineIndex < floorLines.count) floorLines.setMatrixAt(lineIndex++, dummy.matrix);
    }
  }
  dummy.scale.set(1, 1, 1);
  floorLines.instanceMatrix.needsUpdate = true;
  scene.add(floorLines);
  uprights.instanceMatrix.needsUpdate = true;
  beams.instanceMatrix.needsUpdate = true;
  protectors.name = "protectors";
  protectors.instanceMatrix.needsUpdate = true;

  /* ------------------------------------------------------------- pallets
     A bay holds two EUR pallets side by side; an article with three or four
     pallets is stacked two high, which is how cartonised goods are stored in a
     selective rack. Each of the four positions exists up front so inbound
     stock can appear without rebuilding buffers; unused positions are scaled
     to zero.

     Two levels of detail run from the same records: detailed pallet + carton
     load when the camera is close, one flat load box in the overview. */
  const palletRecords = new Map();
  const patternCounts = { smooth: 0, striped: 0, dotted: 0 };
  let palletCursor = 0;
  for (const slot of slots) {
    const records = [];
    for (let i = 0; i < 4; i++) {
      records.push({
        baseIndex: palletCursor++,
        loadIndex: patternCounts[slot.pattern]++,
        x: slot.x,
        z: slot.z + (i % 2 === 0 ? -0.5 : 0.5),
        tier: Math.floor(i / 2),
        y: 0.3 + slot.level * LEVEL_H,
        pattern: slot.pattern,
        rotated: (i + slot.level) % 2 === 1,
      });
    }
    palletRecords.set(slot, records);
  }
  const palletMesh = new THREE.InstancedMesh(
    palletGeometry(),
    palletMaterial,
    Math.max(1, palletCursor),
  );
  palletMesh.name = "pallets";
  palletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(palletMesh);

  const loadTextures = makeLoadTextures();
  const detailLoadMaterials = {
    smooth: new THREE.MeshStandardMaterial({ map: loadTextures.smooth, roughness: 0.88, metalness: 0.01 }),
    striped: new THREE.MeshStandardMaterial({ map: loadTextures.striped, roughness: 0.88, metalness: 0.01 }),
    dotted: new THREE.MeshStandardMaterial({ map: loadTextures.dotted, roughness: 0.88, metalness: 0.01 }),
  };
  const loadMeshes = {};
  const farLoadMeshes = {};
  for (const pattern of ["smooth", "striped", "dotted"]) {
    const capacity = Math.max(1, patternCounts[pattern]);
    const detailed = new THREE.InstancedMesh(loadGeometry(0), detailLoadMaterials[pattern], capacity);
    detailed.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    detailed.name = `load-${pattern}`;
    detailed.visible = patternCounts[pattern] > 0;
    scene.add(detailed);
    loadMeshes[pattern] = detailed;

    const far = new THREE.InstancedMesh(new THREE.BoxGeometry(0.68, 1, 0.92), loadMaterials[pattern], capacity);
    far.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    far.name = `far-${pattern}`;
    far.visible = false;
    scene.add(far);
    farLoadMeshes[pattern] = far;
  }
  let detailedLoads = true;

  /* ----------------------------------------------------- pick faces */
  const cartonMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 0.3, 0.32), cartonMaterial, Math.max(1, totalCartons));
  cartonMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(cartonMesh);

  const benches = [];
  const pickRows = [...new Set(picks.map((pick) => pick.z))];
  for (const z of pickRows) {
    const xs = picks.filter((pick) => pick.z === z).map((pick) => pick.x);
    if (!xs.length) continue;
    const min = Math.min(...xs) - 1;
    const max = Math.max(...xs) + 1;
    benches.push({ x: (min + max) / 2, z, w: max - min });
  }
  for (const bench of benches) {
    const top = new THREE.Mesh(new THREE.BoxGeometry(bench.w, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x6c7d75, roughness: 0.7, metalness: 0.2 }));
    top.position.set(bench.x, 0.9, bench.z);
    scene.add(top);
    for (const dx of [-bench.w / 2 + 0.15, bench.w / 2 - 0.15]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), steelMaterial);
      leg.position.set(bench.x + dx, 0.45, bench.z);
      scene.add(leg);
    }
  }

  /* -------------------------------------------------------------- hits */
  const hitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.05, 2.4, 1.7), new THREE.MeshBasicMaterial({ visible: false }), totalHits);
  const pickHitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.9, 0.9), new THREE.MeshBasicMaterial({ visible: false }), Math.max(1, picks.length));
  scene.add(hitMesh, pickHitMesh);

  /* --------------------------------------------------- mode overlays */
  const heatMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.28, 1, 0.28),
    new THREE.MeshBasicMaterial({ color: 0xd9a35f, transparent: true, opacity: 0.55, depthWrite: false }),
    Math.max(1, slots.length),
  );
  heatMesh.visible = false;
  scene.add(heatMesh);

  const beaconMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.09, 0.09, 3.6, 6, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x8fd3c0, transparent: true, opacity: 0.55, depthWrite: false }),
    Math.max(1, slots.length),
  );
  beaconMesh.visible = false;
  scene.add(beaconMesh);

  const ringMesh = new THREE.InstancedMesh(
    new THREE.RingGeometry(0.55, 0.68, 24),
    new THREE.MeshBasicMaterial({ color: 0xe07b6a, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }),
    Math.max(1, slots.length),
  );
  ringMesh.visible = false;
  scene.add(ringMesh);

  /* --------------------------------------------------- aggregate mode */
  const blocks = model.blocks || [];
  const blockLabelSprites = [];
  let visibleBlocks = blocks.length;
  const blockMesh = blocks.length
    ? new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x93a99d, roughness: 0.8, metalness: 0.1, transparent: true, opacity: 0.94 }),
        blocks.length,
      )
    : null;
  if (blockMesh) {
    blocks.forEach((block, index) => {
      dummy.position.set(block.x, block.h / 2, block.z);
      dummy.scale.set(block.w, block.h, block.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      blockMesh.setMatrixAt(index, dummy.matrix);
      blockMesh.setColorAt(index, new THREE.Color(STATUS_COLOR[dominantStatus(block.status)] ?? STATUS_COLOR.balanced));
    });
    dummy.scale.set(1, 1, 1);
    blockMesh.instanceMatrix.needsUpdate = true;
    if (blockMesh.instanceColor) blockMesh.instanceColor.needsUpdate = true;
    scene.add(blockMesh);
    // Labelling 2,000 clusters would create 2,000 canvas textures. The largest
    // clusters carry a label; every cluster stays hoverable/clickable.
    const labelBudget = blocks.length > 800 ? 18 : 32;
    for (const block of [...blocks].sort((a, b) => b.value - a.value).slice(0, labelBudget)) {
      const sprite = addLabel(block.category, block.x, block.h + 0.7, block.z, 0xc3ccc7, 3.4);
      if (sprite) blockLabelSprites.push({ block, sprite });
    }
    const blockHits = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ visible: false }), blocks.length);
    blocks.forEach((block, index) => {
      dummy.position.set(block.x, block.h / 2, block.z);
      dummy.scale.set(block.w, block.h, block.d);
      dummy.updateMatrix();
      blockHits.setMatrixAt(index, dummy.matrix);
    });
    dummy.scale.set(1, 1, 1);
    blockHits.instanceMatrix.needsUpdate = true;
    scene.add(blockHits);
    blockHits.userData.blocks = true;
    scene.userData.blockHits = blockHits;
    scene.userData.blockMesh = blockMesh;
  }

  /* ------------------------------------------------ progressive cluster detail
     A cluster is loaded on demand and drawn inside its aggregate volume. Up to
     one cluster's individual articles are live at a time; the next click swaps
     the detail set, keeping GPU memory bounded regardless of portfolio size. */
  const MAX_CLUSTER_DETAIL = 250;
  const detailSlots = [];
  let detailCluster = null;
  const detailMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.72, 0.36),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.02 }),
    MAX_CLUSTER_DETAIL,
  );
  detailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  detailMesh.visible = false;
  scene.add(detailMesh);
  const detailHitMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.62, 0.92, 0.56),
    new THREE.MeshBasicMaterial({ visible: false }),
    MAX_CLUSTER_DETAIL,
  );
  detailHitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  detailHitMesh.visible = false;
  scene.add(detailHitMesh);

  function showClusterDetails(payload) {
    if (!payload || !Array.isArray(payload.slots)) return false;
    detailSlots.length = 0;
    const count = Math.min(MAX_CLUSTER_DETAIL, payload.slots.length);
    for (let index = 0; index < count; index++) {
      const slot = payload.slots[index];
      detailSlots.push(slot);
      const y = 0.42 + (slot.level || 0) * LEVEL_H;
      dummy.position.set(slot.x, y, slot.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      detailHitMesh.setMatrixAt(index, dummy.matrix);
      dummy.scale.set(1, 0.92, 1);
      dummy.updateMatrix();
      detailMesh.setMatrixAt(index, dummy.matrix);
      detailMesh.setColorAt(index, new THREE.Color(STATUS_COLOR[slot.status] || STATUS_COLOR.balanced));
    }
    detailMesh.count = count;
    detailHitMesh.count = count;
    detailMesh.instanceMatrix.needsUpdate = true;
    detailHitMesh.instanceMatrix.needsUpdate = true;
    if (detailMesh.instanceColor) detailMesh.instanceColor.needsUpdate = true;
    detailMesh.visible = count > 0;
    detailHitMesh.visible = count > 0;
    detailCluster = payload.cluster || null;
    if (detailCluster) focusPoint(detailCluster.x, 2.2, detailCluster.z, 13);
    return true;
  }

  const focusMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.07, 10, 32),
    new THREE.MeshBasicMaterial({ color: 0xf0c987, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  focusMarker.rotation.x = -Math.PI / 2;
  focusMarker.visible = false;
  scene.add(focusMarker);

  /* ------------------------------------------------------------- docks */
  for (let i = 0; i < 2; i++) addDoor(-36 + i * 9, -18.4, 0);
  for (let i = 0; i < 3; i++) addDoor(14 + i * 9, 21.4, Math.PI);
  const inboundTruck = makeTruck();
  inboundTruck.position.set(-31, 0, -23.5);
  inboundTruck.rotation.y = -Math.PI / 2;
  scene.add(inboundTruck);
  const outboundTruck = makeTruck();
  outboundTruck.position.set(22, 0, 24.8);
  outboundTruck.rotation.y = Math.PI / 2;
  scene.add(outboundTruck);

  function addDoor(x, z, rotation) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 4.6, 0.22), new THREE.MeshStandardMaterial({ color: 0x2a3733, roughness: 0.8 }));
    frame.position.set(x, 2.3, z);
    frame.rotation.y = rotation;
    scene.add(frame);
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.9), new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 1 }));
    opening.position.set(x, 1.95, z + (rotation === 0 ? 0.14 : -0.14));
    opening.rotation.y = rotation === 0 ? 0 : Math.PI;
    scene.add(opening);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.7, 0.05), new THREE.MeshStandardMaterial({ color: 0xd9a35f, roughness: 0.8 }));
      stripe.position.set(x + side * 1.5, 0.35, z + (rotation === 0 ? 0.2 : -0.2));
      scene.add(stripe);
    }
  }

  function makeTruck() {
    const group = new THREE.Group();
    const trailer = new THREE.Mesh(new THREE.BoxGeometry(5.4, 2.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xdfe3dc, roughness: 0.6, metalness: 0.15 }));
    trailer.position.y = 1.7;
    group.add(trailer);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.1, 2.3), new THREE.MeshStandardMaterial({ color: 0x4d6a5f, roughness: 0.5, metalness: 0.25 }));
    cab.position.set(3.4, 1.4, 0);
    group.add(cab);
    const wheelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
    wheelGeometry.rotateX(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2320, roughness: 0.9 });
    for (const x of [-1.9, -0.4, 3.4]) {
      for (const z of [-1.15, 1.15]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.42, z);
        group.add(wheel);
      }
    }
    return group;
  }

  /* --------------------------------------------------------- conveyors */
  addConveyor(-24, -17.2, -6, -17.2);
  addConveyor(0, 15.6, 13, 15.6);
  function addConveyor(x1, z1, x2, z2) {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const angle = Math.atan2(z2 - z1, x2 - x1);
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, 0.24, 0.9), new THREE.MeshStandardMaterial({ color: 0x39463f, roughness: 0.7, metalness: 0.3 }));
    body.position.set((x1 + x2) / 2, 0.72, (z1 + z2) / 2);
    body.rotation.y = -angle;
    scene.add(body);
    const legGeometry = new THREE.BoxGeometry(0.08, 0.72, 0.08);
    const legs = new THREE.InstancedMesh(legGeometry, steelMaterial, Math.max(2, Math.round(length / 2.4) * 2));
    let legIndex = 0;
    for (let t = 0; t <= length; t += 2.4) {
      const px = x1 + Math.cos(angle) * t;
      const pz = z1 + Math.sin(angle) * t;
      for (const offset of [-0.35, 0.35]) {
        dummy.position.set(px + Math.sin(angle) * offset, 0.36, pz - Math.cos(angle) * offset);
        dummy.rotation.set(0, -angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        if (legIndex < legs.count) legs.setMatrixAt(legIndex++, dummy.matrix);
      }
    }
    legs.count = legIndex;
    legs.instanceMatrix.needsUpdate = true;
    scene.add(legs);
  }

  /* ---------------------------------------------------------- forklifts */
  const forklifts = [makeForklift(-0.2), makeForklift(0.35)];
  forklifts[0].group.position.set(-14, 0, -3);
  forklifts[1].group.position.set(9, 0, 9.6);
  scene.add(forklifts[0].group, forklifts[1].group);
  function makeForklift(phase) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0xc79a4c, roughness: 0.6, metalness: 0.2 }));
    body.position.y = 0.62;
    group.add(body);
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.9), steelMaterial);
    mast.position.set(-0.72, 1.5, 0);
    group.add(mast);
    const forks = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.8), new THREE.MeshStandardMaterial({ color: 0x404c47, roughness: 0.8 }));
    forks.position.set(-1.1, 0.24, 0);
    group.add(forks);
    const wheelGeometry = new THREE.CylinderGeometry(0.26, 0.26, 0.18, 10);
    wheelGeometry.rotateX(Math.PI / 2);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2320, roughness: 0.9 });
    for (const x of [-0.45, 0.45]) {
      for (const z of [-0.55, 0.55]) {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.set(x, 0.26, z);
        group.add(wheel);
      }
    }
    return { group, phase };
  }

  /* -------------------------------------------------------------- labels */
  /** Flat floor paint: readable from above, never a panel in front of the lens. */
  function addFloorLabel(text, x, z, width = 3, color = 0x9fb0a7) {
    const canvasLabel = document.createElement("canvas");
    canvasLabel.width = 512;
    canvasLabel.height = 128;
    const ctx = canvasLabel.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 128);
    ctx.font = "600 58px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text).toUpperCase(), 256, 64, 474);
    ctx.fillRect(74, 102, 364, 3);
    const texture = new THREE.CanvasTexture(canvasLabel);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width / 4),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.72, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.055, z);
    mesh.renderOrder = 1;
    scene.add(mesh);
    return mesh;
  }

  function addLabel(text, x, y, z, color = 0xc3ccc7, width = 4) {
    const canvasLabel = document.createElement("canvas");
    canvasLabel.width = 512;
    canvasLabel.height = 128;
    const ctx = canvasLabel.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = "rgba(12,20,17,.72)";
    ctx.fillRect(0, 24, 512, 80);
    ctx.font = "600 44px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // Clamp long category + band + range labels so they never clip the canvas.
    ctx.fillText(String(text).toUpperCase(), 256, 66, 480);
    const texture = new THREE.CanvasTexture(canvasLabel);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(width, width / 4, 1);
    sprite.position.set(x, y, z);
    scene.add(sprite);
    return sprite;
  }

  // ABC band titles, painted on the floor beside the rows. They carry the same
  // information as the old hanging signs without standing in the sight line.
  if (slots.length) {
    for (const [band, z, label] of [
      ["A", 5.2, "A"],
      ["B", -1.5, "B"],
      ["C", -8.2, "C"],
    ]) {
      addFloorLabel(sv ? `${label}-zon` : `Zone ${label}`, -33, z, 3.8, 0xd9a35f);
    }
    addFloorLabel(sv ? "Inaktivt" : "Inactive", -38, 11, 3.4, 0x9aa6a0);
  }

  /* --------------------------------------------------------------- tokens */
  const TOKEN_CAPACITY = 30;
  const tokenMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.42, 0.34, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xd9a35f, roughness: 0.7, emissive: 0x2a1c0c, emissiveIntensity: 0.4 }),
    TOKEN_CAPACITY,
  );
  tokenMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(tokenMesh);
  const tokens = [];
  let tokenCursor = 0;
  for (let i = 0; i < TOKEN_CAPACITY; i++) {
    dummy.position.set(0, -8, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(0.0001, 0.0001, 0.0001);
    dummy.updateMatrix();
    tokenMesh.setMatrixAt(i, dummy.matrix);
  }
  tokenMesh.instanceMatrix.needsUpdate = true;
  dummy.scale.set(1, 1, 1);

  function spawnToken(points, kind, payload) {
    // A curve instead of straight segments: a pallet does not turn on a point,
    // and the eased path is what makes the flow read as a truck moving.
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.25);
    const token = {
      points,
      curve,
      kind,
      payload,
      u: 0,
      // Metres per second, converted to a 0..1 curve parameter below.
      speed: (kind === "inbound" ? 5.2 : 6.4) / Math.max(1, curve.getLength()),
      slot: tokenCursor++ % TOKEN_CAPACITY,
    };
    tokens.push(token);
    return token;
  }

  function pathLength(points) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    return Math.max(1, length);
  }

  /* ------------------------------------------------------------ controls */
  const view = {
    radius: 39,
    theta: 0.56,
    phi: 1.04,
    target: new THREE.Vector3(0, 1.6, 7),
    goal: { radius: 39, theta: 0.56, phi: 1.04, target: new THREE.Vector3(0, 1.6, 7) },
  };
  const rackBounds = frames.reduce(
    (bounds, frame) => ({
      minX: Math.min(bounds.minX, frame.x),
      maxX: Math.max(bounds.maxX, frame.x),
      minZ: Math.min(bounds.minZ, frame.z),
      maxZ: Math.max(bounds.maxZ, frame.z + frame.bays * BAY),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  );
  const rackSpan = Number.isFinite(rackBounds.minX)
    ? Math.max(rackBounds.maxX - rackBounds.minX, rackBounds.maxZ - rackBounds.minZ)
    : sceneSpan * 0.5;
  const rackCenter = Number.isFinite(rackBounds.minX)
    ? new THREE.Vector3((rackBounds.minX + rackBounds.maxX) / 2, 1.6, (rackBounds.minZ + rackBounds.maxZ) / 2)
    : new THREE.Vector3(0, 1.6, 7);
  const overviewRadius = Math.max(26, Math.min(sceneSpan * 0.8, rackSpan * 1.15));
  const OVERVIEW = { radius: overviewRadius, theta: 0.56, phi: 1.12, target: rackCenter.clone() };
  view.radius = overviewRadius;
  view.goal.radius = overviewRadius;

  /* Pointer + trackpad + touch navigation.
     One pointer orbits, shift/right/middle drag pans, two fingers pinch-zoom and
     pan, the wheel zooms toward the cursor. Every gesture only writes a goal;
     the render loop eases toward it, so no input can snap the camera. */
  let dragging = null;
  let moved = false;
  const activePointers = new Map();
  let pinch = null;

  const clampRadius = (value) => Math.min(Math.max(220, sceneSpan * 2.4), Math.max(1.7, value));

  function panBy(dx, dy, scale = view.radius * 0.0016) {
    const right = new THREE.Vector3(Math.cos(view.theta), 0, -Math.sin(view.theta));
    const forward = new THREE.Vector3(-Math.sin(view.theta), 0, -Math.cos(view.theta));
    view.goal.target.addScaledVector(right, -dx * scale).addScaledVector(forward, dy * scale);
  }

  function zoomAt(clientX, clientY, factor) {
    const before = view.goal.radius;
    view.goal.radius = clampRadius(before * factor);
    // Pull the orbit centre toward the point under the cursor so zooming into an
    // aisle does not require a second pan afterwards.
    const applied = before / view.goal.radius;
    if (Math.abs(1 - applied) < 1e-4) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const distance = camera.position.distanceTo(view.target);
    const point = raycaster.ray.at(distance, new THREE.Vector3());
    const shift = Math.min(0.6, Math.max(0, (1 - applied) * 0.55));
    view.goal.target.lerp(point, shift);
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture?.(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      dragging = null;
      return;
    }
    dragging = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.button === 1 || event.shiftKey };
    moved = false;
  });
  canvas.addEventListener("pointermove", (event) => {
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && activePointers.size === 2) {
      const [a, b] = [...activePointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (distance > 8 && pinch.distance > 8) zoomAt(midX, midY, pinch.distance / distance);
      panBy(midX - pinch.midX, midY - pinch.midY);
      pinch = { distance, midX, midY };
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
    } else {
      view.goal.theta -= dx * 0.0055;
      view.goal.phi = Math.min(1.46, Math.max(0.18, view.goal.phi - dy * 0.0042));
    }
  });
  const endPointer = (event) => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinch = null;
    if (activePointers.size === 0) dragging = null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const factor = Math.exp(event.deltaY * (event.ctrlKey ? 0.008 : 0.0011));
      zoomAt(event.clientX, event.clientY, factor);
    },
    { passive: false },
  );
  canvas.addEventListener("dblclick", () => setView(OVERVIEW));

  canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 12 : 4;
    switch (event.key) {
      case "ArrowLeft":
        view.goal.theta += 0.09;
        break;
      case "ArrowRight":
        view.goal.theta -= 0.09;
        break;
      case "ArrowUp":
        view.goal.phi = Math.min(1.46, view.goal.phi - 0.06);
        break;
      case "ArrowDown":
        view.goal.phi = Math.max(0.18, view.goal.phi + 0.06);
        break;
      case "+":
      case "=":
        view.goal.radius = clampRadius(view.goal.radius / 1.2);
        break;
      case "-":
      case "_":
        view.goal.radius = clampRadius(view.goal.radius * 1.2);
        break;
      case "0":
      case "Home":
        setView(OVERVIEW);
        break;
      case "PageUp":
        stepAisle(-1);
        break;
      case "PageDown":
        stepAisle(1);
        break;
      case "w":
        panBy(0, step);
        break;
      case "s":
        panBy(0, -step);
        break;
      case "a":
        panBy(step, 0);
        break;
      case "d":
        panBy(-step, 0);
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  function setView(next) {
    if (next.radius) view.goal.radius = clampRadius(next.radius);
    if (next.theta !== undefined) view.goal.theta = next.theta;
    if (next.phi !== undefined) view.goal.phi = next.phi;
    if (next.target) view.goal.target.copy(next.target);
  }

  /* ------------------------------------------ selection highlight / aisles */
  const selectionBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1.3, 2.06)),
    new THREE.LineBasicMaterial({ color: 0xf0c987, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
  );
  selectionBox.visible = false;
  selectionBox.renderOrder = 10;
  scene.add(selectionBox);

  function selectSlot(slot) {
    if (!slot) {
      selectionBox.visible = false;
      focusMarker.visible = false;
      return;
    }
    // Centre the frame on the clear opening of the level, not on the beam.
    const levelY = 0.95 + (slot.level || 0) * LEVEL_H;
    selectionBox.position.set(slot.x, levelY, slot.z);
    selectionBox.visible = true;
    focusMarker.position.set(slot.x, 0.06, slot.z);
    focusMarker.visible = true;
  }

  // Aisle index for the stepper and for the on-screen "A-03" label. Built from
  // the same frames the racks are drawn from, so it can never drift.
  const aisleList = [];
  {
    // The aisle is the gap *between* two rack rows, so the camera and the label
    // go to the midpoint of neighbouring rows, never on top of a rack.
    for (const band of ["A", "B", "C"]) {
      const rows = frames.filter((frame) => frame.band === band).sort((a, b) => a.x - b.x);
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        aisleList.push({
          band,
          x: (rows[i - 1].x + row.x) / 2,
          z: row.z + (row.bays * BAY) / 2,
          endZ: row.z + row.bays * BAY + 0.9,
          label: `${band}-${String(i).padStart(2, "0")}`,
        });
      }
    }
  }
  let currentAisle = -1;
  let onAisle = null;
  function stepAisle(direction) {
    if (!aisleList.length) return;
    if (currentAisle < 0) {
      let nearest = 0;
      let distance = Infinity;
      aisleList.forEach((aisle, index) => {
        const d = Math.hypot(aisle.x - view.goal.target.x, aisle.z - view.goal.target.z);
        if (d < distance) {
          distance = d;
          nearest = index;
        }
      });
      currentAisle = nearest;
    } else {
      currentAisle = (currentAisle + (direction >= 0 ? 1 : -1) + aisleList.length) % aisleList.length;
    }
    const aisle = aisleList[currentAisle];
    // Eye-level view from the aisle entrance, looking down the corridor.
    setView({
      target: new THREE.Vector3(aisle.x, 1.7, aisle.z),
      radius: 9,
      theta: 0,
      phi: 1.34,
    });
    onAisle?.(aisle);
  }

  // Row signs stand on the rack end frame, so they read like real aisle signs.
  {
    const rows = frames.filter((frame) => frame.band !== "pick").sort((a, b) => {
      const order = { A: 0, B: 1, C: 2 };
      return order[a.band] - order[b.band] || a.x - b.x;
    });
    const perBand = { A: 0, B: 0, C: 0 };
    const stride = rows.length > 24 ? Math.ceil(rows.length / 24) : 1;
    rows.forEach((frame, index) => {
      const number = (perBand[frame.band] = (perBand[frame.band] ?? 0) + 1);
      if (index % stride !== 0) return;
      const endZ = frame.z + frame.bays * BAY + 0.9;
      addLabel(`${frame.band}-${String(number).padStart(2, "0")}`, frame.x, 2.85, endZ, 0xb9c7b4, 2.4);
    });
  }

  /* -------------------------------------------------------------- picking */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const targets = [hitMesh, pickHitMesh];
    if (detailHitMesh.visible) targets.push(detailHitMesh);
    const blockHits = scene.userData.blockHits;
    if (blockHits && blockHits.visible) targets.push(blockHits);
    const found = raycaster.intersectObjects(targets, false);
    if (!found.length) return null;
    const hit = found[0];
    const index = hit.instanceId ?? -1;
    if (hit.object === pickHitMesh) {
      const pick = picks[index];
      return pick ? slotBySku.get(pick.sku) ?? null : null;
    }
    if (hit.object === detailHitMesh) {
      return detailSlots[index] ?? null;
    }
    if (hit.object === blockHits) {
      const block = blocks[index];
      return block ? { sku: `__cluster_${index}`, name: block.category, block, blockIndex: index } : null;
    }
    return slots[index] ?? null;
  }
  canvas.addEventListener("click", (event) => {
    if (moved) return;
    const entry = pickAt(event.clientX, event.clientY);
    if (!entry) {
      selectSlot(null);
      return;
    }
    if (entry.block) {
      focusPoint(entry.block.x, entry.block.h * 0.5, entry.block.z, 26);
      onExpandCluster?.(entry.block, entry.blockIndex);
      return;
    }
    selectSlot(entry);
    focusSlot(entry);
    onSelect?.(entry.sku);
  });

  /* --------------------------------------------------------- scene layout */
  let mode = "physical";
  let filter = { category: "", abc: "", xyz: "", status: "", query: "" };
  let month = 12;
  let playing = false;
  let speed = 1;
  let clock = 0;
  let simClock = 0;
  let visibleCount = slots.length;
  let simRun = null;
  let simDay = 0;

  const abcRank = { A: 0, B: 1, C: 2 };
  const valueSorted = [...slots].sort((a, b) => a.value - b.value);
  const valueRank = new Map(valueSorted.map((slot, index) => [slot.sku, valueSorted.length > 1 ? index / (valueSorted.length - 1) : 1]));
  const demandSorted = [...slots].sort((a, b) => a.avgMonthly - b.avgMonthly);
  const demandRank = new Map(demandSorted.map((slot, index) => [slot.sku, demandSorted.length > 1 ? index / (demandSorted.length - 1) : 1]));

  function heatColor(rank) {
    const scaled = Math.min(0.999, Math.max(0, rank)) * (HEAT_STOPS.length - 1);
    const index = Math.floor(scaled);
    const next = Math.min(HEAT_STOPS.length - 1, index + 1);
    const color = new THREE.Color(HEAT_STOPS[index]);
    color.lerp(new THREE.Color(HEAT_STOPS[next]), scaled - index);
    return color;
  }

  function matches(slot) {
    const uncategorised = sv ? "Utan kategori" : "Uncategorised";
    if (filter.category && (slot.category ?? uncategorised) !== filter.category) return false;
    if (filter.abc && slot.abc !== filter.abc) return false;
    if (filter.xyz && (slot.xyz ?? "") !== filter.xyz) return false;
    if (filter.status && slot.status !== filter.status) return false;
    if (filter.query) {
      const query = filter.query.toLowerCase();
      if (!`${slot.sku} ${slot.name}`.toLowerCase().includes(query)) return false;
    }
    return true;
  }

  function modeVisible(slot) {
    if (mode === "overstock") return slot.status === "overstock";
    if (mode === "stockout") return slot.status === "stockout";
    if (mode === "replenish") return needsReplenish(slot);
    return true;
  }

  function needsReplenish(slot) {
    return slot.stock <= slot.reorderPoint || (slot.coverDays !== null && slot.coverDays < slot.leadTimeDays);
  }

  function colorFor(slot) {
    if (!matches(slot)) return new THREE.Color(DIM);
    if (mode === "abc") return new THREE.Color(ABC_COLOR[slot.abc] ?? STATUS_COLOR.balanced);
    if (mode === "heatmap") return heatColor(valueRank.get(slot.sku) ?? 0);
    if (mode === "overstock") return new THREE.Color(STATUS_COLOR.overstock);
    if (mode === "stockout") return new THREE.Color(STATUS_COLOR.stockout);
    if (mode === "replenish") return new THREE.Color(0x8fd3c0);
    if (mode === "demand") {
      const rank = demandRank.get(slot.sku) ?? 0;
      return new THREE.Color(0x9fb8a8).lerp(new THREE.Color(0xd9a35f), rank);
    }
    return new THREE.Color(STATUS_COLOR[slot.status] ?? STATUS_COLOR.balanced);
  }

  function slotVisible(slot) {
    return matches(slot) && modeVisible(slot);
  }

  function palletHeight(stock) {
    const count = stock > 0 ? Math.min(4, Math.max(1, Math.ceil(stock / unit))) : 0;
    const remainder = stock % unit;
    const fill = stock > 0 ? Math.min(1, Math.max(0.12, (remainder === 0 ? unit : remainder) / unit)) : 0;
    return { count, fill };
  }

  function layoutSlot(slot) {
    const visible = slotVisible(slot);
    const count = visible ? Math.min(4, slot.pallets || 0) : 0;
    const fill = slot.fill || 0;
    const loadHeight = count > 0 ? 0.22 + fill * (LOAD_HEIGHT - 0.22) : 0;
    const color = colorFor(slot);
    const records = palletRecords.get(slot) || [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const y = record.y + record.tier * (PALLET.h + loadHeight);
      // A stacked pallet must stay below the next beam; otherwise the bay
      // shows only its floor-level pallets instead of clipping the rack.
      const show = i < count && y + PALLET.h + loadHeight <= RACK_TOP - 0.12;
      dummy.position.set(record.x, y, record.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(show ? 1 : 0.0001, show ? 1 : 0.0001, show ? 1 : 0.0001);
      dummy.updateMatrix();
      palletMesh.setMatrixAt(record.baseIndex, dummy.matrix);

      // Detailed carton stack in place of the old stretched box. Rotating the
      // stack by 180° gives neighbouring pallets a different silhouette.
      dummy.position.set(record.x, y + 0.004, record.z);
      dummy.rotation.set(0, record.rotated ? Math.PI : 0, 0);
      dummy.scale.set(show ? 1 : 0.0001, show ? Math.max(0.18, loadHeight / 0.8) : 0.0001, show ? 1 : 0.0001);
      dummy.updateMatrix();
      const mesh = loadMeshes[record.pattern] || loadMeshes.smooth;
      mesh.setMatrixAt(record.loadIndex, dummy.matrix);
      mesh.setColorAt(record.loadIndex, color);

      // Far level of detail: a single load volume in the same footprint.
      dummy.position.set(record.x, y + PALLET.h + loadHeight / 2, record.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(show ? 1 : 0.0001, show ? Math.max(0.05, loadHeight) : 0.0001, show ? 1 : 0.0001);
      dummy.updateMatrix();
      const far = farLoadMeshes[record.pattern] || farLoadMeshes.smooth;
      far.setMatrixAt(record.loadIndex, dummy.matrix);
      far.setColorAt(record.loadIndex, color);
    }

    // Heat column: height and colour carry the tied-up capital.
    const columnHeight = visible && mode === "heatmap" ? 0.8 + (valueRank.get(slot.sku) ?? 0) * 7 : 0.0001;
    dummy.position.set(slot.x, columnHeight / 2 + 0.05, slot.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(visible && mode === "heatmap" ? 1 : 0.0001, columnHeight, 1);
    dummy.updateMatrix();
    heatMesh.setMatrixAt(slot.index, dummy.matrix);
    heatMesh.setColorAt(slot.index, color);

    // Replenishment beacon above the slot.
    const beaconScale = visible && mode === "replenish" ? 1 : 0.0001;
    dummy.position.set(slot.x, 2.6 + slot.level * LEVEL_H, slot.z);
    dummy.scale.set(beaconScale, beaconScale, beaconScale);
    dummy.updateMatrix();
    beaconMesh.setMatrixAt(slot.index, dummy.matrix);
    beaconMesh.setColorAt(slot.index, new THREE.Color(0x8fd3c0));

    // Stockout ring painted on the floor in front of the bay.
    const ringScale = visible && mode === "stockout" ? 1 : 0.0001;
    dummy.position.set(slot.x, 0.06, slot.z + 0.95);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(ringScale, ringScale, 1);
    dummy.updateMatrix();
    ringMesh.setMatrixAt(slot.index, dummy.matrix);
    dummy.rotation.set(0, 0, 0);

    // Invisible hit volume.
    const hitScale = visible ? 1 : 0.0001;
    dummy.position.set(slot.x, 1.4 + slot.level * LEVEL_H, slot.z);
    dummy.scale.set(hitScale, hitScale, hitScale);
    dummy.updateMatrix();
    hitMesh.setMatrixAt(slot.index, dummy.matrix);

    // Picking cartons on the flow bench.
    const pick = pickBySku.get(slot.sku);
    if (pick) {
      for (let i = 0; i < pick.cartons; i++) {
        const offset = (i - (pick.cartons - 1) / 2) * 0.36;
        dummy.position.set(pick.x + offset, 1.08, pick.z);
        dummy.scale.set(hitScale, hitScale, hitScale);
        dummy.updateMatrix();
        cartonMesh.setMatrixAt(pickCartonIndex(pick, i), dummy.matrix);
        cartonMesh.setColorAt(pickCartonIndex(pick, i), color);
      }
      dummy.position.set(pick.x, 0.95, pick.z);
      dummy.scale.set(hitScale, hitScale, hitScale);
      dummy.updateMatrix();
      pickHitMesh.setMatrixAt(pick.index, dummy.matrix);
    }
    dummy.scale.set(1, 1, 1);
  }

  const cartonBase = new Map();
  {
    let cursor = 0;
    for (const pick of picks) {
      cartonBase.set(pick.sku, cursor);
      cursor += pick.cartons;
    }
  }
  function pickCartonIndex(pick, i) {
    return (cartonBase.get(pick.sku) ?? 0) + i;
  }

  function applyLayout() {
    visibleCount = 0;
    for (const slot of slots) {
      if (slotVisible(slot)) visibleCount++;
      layoutSlot(slot);
    }
    palletMesh.instanceMatrix.needsUpdate = true;
    for (const pattern of Object.keys(loadMeshes)) {
      for (const mesh of [loadMeshes[pattern], farLoadMeshes[pattern]]) {
        if (!mesh) continue;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    cartonMesh.instanceMatrix.needsUpdate = true;
    if (cartonMesh.instanceColor) cartonMesh.instanceColor.needsUpdate = true;
    hitMesh.instanceMatrix.needsUpdate = true;
    pickHitMesh.instanceMatrix.needsUpdate = true;
    heatMesh.instanceMatrix.needsUpdate = true;
    if (heatMesh.instanceColor) heatMesh.instanceColor.needsUpdate = true;
    beaconMesh.instanceMatrix.needsUpdate = true;
    ringMesh.instanceMatrix.needsUpdate = true;
    const hasSlots = slots.length > 0;
    heatMesh.visible = hasSlots && mode === "heatmap";
    beaconMesh.visible = hasSlots && mode === "replenish";
    ringMesh.visible = hasSlots && mode === "stockout";
    palletMesh.visible = hasSlots;
    for (const pattern of Object.keys(loadMeshes)) {
      if (loadMeshes[pattern]) loadMeshes[pattern].visible = hasSlots && detailedLoads && (patternCounts[pattern] ?? 0) > 0;
      if (farLoadMeshes[pattern]) farLoadMeshes[pattern].visible = hasSlots && !detailedLoads && (patternCounts[pattern] ?? 0) > 0;
    }
    cartonMesh.visible = hasSlots && picks.length > 0;
    hitMesh.visible = hasSlots;
    pickHitMesh.visible = picks.length > 0;
    applyBlockVisibility();
    onVisibility?.(slots.length ? visibleCount : visibleBlocks);
  }
  applyLayout();

  /* ---------------------------------------------------------- aggregation */
  function dominantStatus(status) {
    const entries = Object.entries(status || {}).sort((a, b) => b[1] - a[1]);
    return entries[0] ? entries[0][0] : "balanced";
  }

  function blockMatches(block) {
    if (filter.category && (block.categoryName ?? "") !== filter.category) return false;
    if (filter.abc && (block.band ?? "") !== filter.abc) return false;
    if (filter.xyz && (block.xyz ?? "") !== filter.xyz) return false;
    if (filter.status && !((block.status && block.status[filter.status]) > 0)) return false;
    if (mode === "overstock" && !((block.status && block.status.overstock) > 0)) return false;
    if (mode === "stockout" && !((block.status && block.status.stockout) > 0)) return false;
    return true;
  }

  function applyBlockVisibility() {
    if (!blockMesh) return;
    visibleBlocks = 0;
    blocks.forEach((block, index) => {
      const show = blockMatches(block);
      if (show) visibleBlocks++;
      dummy.position.set(block.x, block.h / 2, block.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(show ? block.w : 0.0001, show ? block.h : 0.0001, show ? block.d : 0.0001);
      dummy.updateMatrix();
      blockMesh.setMatrixAt(index, dummy.matrix);
      if (scene.userData.blockHits) scene.userData.blockHits.setMatrixAt(index, dummy.matrix);
    });
    dummy.scale.set(1, 1, 1);
    blockMesh.instanceMatrix.needsUpdate = true;
    if (scene.userData.blockHits) scene.userData.blockHits.instanceMatrix.needsUpdate = true;
    for (const entry of blockLabelSprites) entry.sprite.visible = blockMatches(entry.block);
  }

  /* ---------------------------------------------------------- simulation */
  const listened = [];
  function stockOf(sku) {
    const slot = slotBySku.get(sku);
    return slot ? slot.stock : 0;
  }

  function recomputeSlot(slot) {
    const { count, fill } = palletHeight(slot.stock);
    slot.pallets = count;
    slot.fill = fill;
    layoutSlot(slot);
    palletMesh.instanceMatrix.needsUpdate = true;
    for (const pattern of Object.keys(loadMeshes)) {
      loadMeshes[pattern].instanceMatrix.needsUpdate = true;
      farLoadMeshes[pattern].instanceMatrix.needsUpdate = true;
    }
    if (cartonMesh.instanceColor) cartonMesh.instanceColor.needsUpdate = true;
  }

  function applyStock(sku, delta) {
    const slot = slotBySku.get(sku);
    if (!slot) return;
    slot.stock = Math.max(0, Math.round((slot.stock + delta) * 100) / 100);
    recomputeSlot(slot);
    onStock?.(sku, slot.stock);
    pulses.push({ sku, at: clock, tone: delta > 0 ? 0x8fd3c0 : 0xd9a35f });
  }
  const pulses = [];

  function transferPath(slot) {
    const pick = pickBySku.get(slot.sku);
    const end = pick ? new THREE.Vector3(pick.x, 1.15, pick.z) : new THREE.Vector3(slot.x + 1.8, 1.15, slot.z + 1.2);
    return [
      new THREE.Vector3(slot.x, 1.2 + slot.level * LEVEL_H, slot.z + 0.8),
      new THREE.Vector3(slot.x + 1.4, 1.2, slot.z + 1.4),
      end,
    ];
  }

  function spawnMoveTokens(day) {
    if (!day || !day.moves) return;
    let spawned = 0;
    for (const move of day.moves) {
      if (spawned >= 6) break;
      const slot = slotBySku.get(move.sku);
      if (!slot) continue;
      const kind = move.kind === "in" ? "inbound" : move.kind === "out" ? "outbound" : "transfer";
      const points =
        move.kind === "in" ? inboundPath(slot) : move.kind === "out" ? outboundPath(slot) : transferPath(slot);
      spawnToken(points, kind, { sku: move.sku, qty: move.qty });
      spawned++;
    }
  }

  /* With clustered portfolios there are no per-article slots to animate, so the
     day's aggregate flows drive a few tokens along the real dock lanes. The
     numbers on the page still come from every article. */
  function spawnAggregateTokens(day) {
    if (slots.length || !day || !day.metrics) return;
    const inbound = day.metrics.inboundUnits || 0;
    const outbound = day.metrics.outboundUnits || 0;
    if (inbound <= 0 && outbound <= 0) return;
    const inboundLane = [
      new THREE.Vector3(-33, 1.3, -22.4),
      new THREE.Vector3(-22, 1.3, -14),
      new THREE.Vector3(-8, 1.3, -4),
    ];
    const outboundLane = [
      new THREE.Vector3(2, 1.2, 6),
      new THREE.Vector3(14, 1.2, 17.6),
      new THREE.Vector3(22, 1.6, 23.6),
    ];
    if (inbound > 0) spawnToken(inboundLane, "inbound", { sku: "", qty: inbound });
    if (outbound > 0) spawnToken(outboundLane, "outbound", { sku: "", qty: outbound });
  }

  function applySimDay(index, animate) {
    if (!simRun || !simRun.days) return false;
    const day = simRun.days[Math.max(0, Math.min(simRun.days.length - 1, Number(index) || 0))];
    if (!day) return false;
    simDay = day.day;
    for (const change of day.changed || []) {
      const slot = slotBySku.get(change.sku);
      if (!slot) continue;
      slot.stock = change.stock;
      slot.status = change.status;
      const { count, fill } = palletHeight(slot.stock);
      slot.pallets = count;
      slot.fill = fill;
      onStock?.(change.sku, slot.stock);
    }
    applyLayout();
    if (animate) {
      spawnMoveTokens(day);
      spawnAggregateTokens(day);
    }
    renderer.render(scene, camera);
    return true;
  }

  function pickOutboundSlot() {
    const candidates = slots.filter((slot) => matches(slot) && slot.stock > 0 && slot.avgMonthly > 0);
    if (!candidates.length) return null;
    const total = candidates.reduce((sum, slot) => sum + slot.avgMonthly, 0);
    let target = Math.random() * total;
    for (const slot of candidates) {
      target -= slot.avgMonthly;
      if (target <= 0) return slot;
    }
    return candidates[candidates.length - 1];
  }

  function outboundPath(slot) {
    const pick = pickBySku.get(slot.sku);
    const start = pick ? new THREE.Vector3(pick.x, 1.2, pick.z) : new THREE.Vector3(slot.x, 1.4 + slot.level * LEVEL_H, slot.z + 0.9);
    return [
      start,
      new THREE.Vector3(6, 1.2, 14.6),
      new THREE.Vector3(14, 1.2, 17.6),
      new THREE.Vector3(22, 1.6, 23.6),
    ];
  }

  function inboundPath(slot) {
    return [
      new THREE.Vector3(-33, 1.3, -22.4),
      new THREE.Vector3(-24, 1.3, -17.6),
      new THREE.Vector3(-6, 1.3, -14.4),
      new THREE.Vector3(slot.x, 1.3 + slot.level * LEVEL_H, slot.z + 0.8),
    ];
  }

  function startOutbound() {
    const slot = pickOutboundSlot();
    if (!slot) return;
    const demand = Math.max(1, Math.round(Math.max(1, monthFactor()) * (slot.avgMonthly || 1) / 4));
    const qty = Math.min(slot.stock, demand);
    if (qty <= 0) return;
    spawnToken(outboundPath(slot), "outbound", { sku: slot.sku, qty });
  }

  function startInbound() {
    const target = slots
      .filter((slot) => slotVisible(slot) && needsReplenish(slot))
      .sort((a, b) => a.stock / Math.max(1, a.reorderPoint) - b.stock / Math.max(1, b.reorderPoint))[0];
    if (!target) return;
    const qty = Math.max(1, Math.ceil(target.reorderPoint - target.stock));
    spawnToken(inboundPath(target), "inbound", { sku: target.sku, qty });
  }

  function monthFactor() {
    const slot = slots.find((entry) => entry.demand && entry.demand.length >= month);
    if (!slot) return 1;
    const average = slot.demand.reduce((a, b) => a + b, 0) / slot.demand.length || 1;
    return Math.min(2, Math.max(0.2, (slot.demand[month - 1] || 0) / average));
  }

  function updateTokens(dt) {
    for (let i = tokens.length - 1; i >= 0; i--) {
      const token = tokens[i];
      token.u = Math.min(1, token.u + dt * token.speed * speed);
      if (token.u >= 0.999) {
        // Stock is owned by the simulation engine and is applied when a day is
        // shown. Tokens only visualise that move, so they never mutate it.
        tokens.splice(i, 1);
        continue;
      }
      const point = token.curve.getPointAt(token.u);
      dummy.position.copy(point);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(token.kind === "inbound" ? 1 : 0.9, 1, 1);
      dummy.updateMatrix();
      tokenMesh.setMatrixAt(token.slot, dummy.matrix);
      tokenMesh.setColorAt(
        token.slot,
        new THREE.Color(token.kind === "inbound" ? 0x8fd3c0 : token.kind === "transfer" ? 0x7fa9c6 : 0xd9a35f),
      );
    }
    for (let i = 0; i < TOKEN_CAPACITY; i++) {
      if (!tokens.some((token) => token.slot === i)) {
        dummy.position.set(0, -5, 0);
        dummy.scale.set(0.0001, 0.0001, 0.0001);
        dummy.updateMatrix();
        tokenMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    dummy.scale.set(1, 1, 1);
    tokenMesh.count = TOKEN_CAPACITY;
    tokenMesh.instanceMatrix.needsUpdate = true;
    if (tokenMesh.instanceColor) tokenMesh.instanceColor.needsUpdate = true;
  }

  function pointAlong(points, distance) {
    let remaining = distance;
    for (let i = 1; i < points.length; i++) {
      const segment = points[i].distanceTo(points[i - 1]);
      if (remaining <= segment) {
        const t = remaining / segment;
        const point = points[i - 1].clone().lerp(points[i], t);
        point.y += Math.sin(t * Math.PI) * 0.25;
        return point;
      }
      remaining -= segment;
    }
    return points[points.length - 1].clone();
  }

  /* --------------------------------------------------------- detail level */
  let lastDetailRadius = -1;
  function applyDetailLevel(radius) {
    const detailed = radius < 48;
    detailedLoads = detailed;
    for (const pattern of Object.keys(loadMeshes)) {
      const present = (patternCounts[pattern] ?? 0) > 0 && slots.length > 0;
      loadMeshes[pattern].visible = present && detailed;
      farLoadMeshes[pattern].visible = present && !detailed;
    }
    lastDetailRadius = radius;
  }

  /* ------------------------------------------------------------- loop */
  let loopRunning = true;
  let paused = false;
  let inView = true;
  let last = performance.now();
  let frameCount = 0;
  let frameWindowStart = performance.now();
  let fps = 0;
  let qualityBase = 1;
  let qualityScale = 0;
  let lastQualityChange = 0;

  const observer = new IntersectionObserver(
    (entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
    },
    { threshold: 0.05 },
  );
  observer.observe(canvas);

  function tick(now) {
    if (!loopRunning) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (paused || document.hidden || !inView) return;
    clock += dt;

    // Detail level follows the camera: close up shows real pallets and carton
    // stacks, the overview falls back to one box per load.
    if (Math.abs(view.radius - lastDetailRadius) > 6) applyDetailLevel(view.radius);

    // Camera easing
    view.radius += (view.goal.radius - view.radius) * Math.min(1, dt * 5);
    view.theta += (view.goal.theta - view.theta) * Math.min(1, dt * 5);
    view.phi += (view.goal.phi - view.phi) * Math.min(1, dt * 5);
    view.target.lerp(view.goal.target, Math.min(1, dt * 5));
    const sinPhi = Math.sin(view.phi);
    camera.position.set(
      view.target.x + view.radius * sinPhi * Math.sin(view.theta),
      view.target.y + view.radius * Math.cos(view.phi),
      view.target.z + view.radius * sinPhi * Math.cos(view.theta),
    );
    camera.lookAt(view.target);

    // Zooming in is a request for detail. Expand the nearest aggregate cluster
    // once per visit, with a throttle so camera easing cannot spam the server.
    if (onExpandCluster && blocks.length && detailMesh.visible === false && view.radius < 24 && now - lastAutoExpand > 1800) {
      let nearestIndex = -1;
      let nearestDistance = Infinity;
      for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const distance = Math.hypot(block.x - view.target.x, block.z - view.target.z);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      }
      const nearest = nearestIndex >= 0 ? blocks[nearestIndex] : null;
      const key = nearest && (nearest.id || nearestIndex);
      if (nearest && nearestDistance < 18 && !autoExpanded.has(key)) {
        autoExpanded.add(key);
        lastAutoExpand = now;
        onExpandCluster(nearest, nearestIndex);
      }
    }

    simClock += dt;
    updateTokens(dt);

    // Ambient equipment motion is decorative and independent of the simulated
    // stock; the engine owns all quantities.
    forklifts.forEach((forklift, index) => {
      const span = 34;
      const t = (simClock * (0.12 + index * 0.03) + forklift.phase) % 2;
      const raw = t < 1 ? t : 2 - t;
      // Smoothstep at both ends: the truck slows, turns and pulls away instead
      // of teleporting its direction at the end of the aisle.
      const forward = raw * raw * (3 - 2 * raw);
      const lane = index === 0 ? -6.5 : 9.6;
      forklift.group.position.set(-17 + forward * span, 0, lane + Math.sin(simClock * 0.6 + index) * 0.4);
      const turn = t < 1 ? 0 : Math.PI;
      forklift.group.rotation.y += (turn - forklift.group.rotation.y) * Math.min(1, dt * 6);
    });

    const cycle = (simClock % 18) / 18;
    inboundTruck.position.z = -23.5 + Math.sin(cycle * Math.PI * 2) * 1.2;
    outboundTruck.position.z = 24.8 - Math.sin(cycle * Math.PI * 2) * 1.2;

    // Gentle stockout pulse (scale only, no per-instance opacity).
    if (mode === "stockout") {
      const pulse = 1 + Math.sin(clock * 4) * 0.08;
      ringMesh.scale.set(pulse, pulse, 1);
    }

    renderer.render(scene, camera);
    frameCount++;
    // Report every half second instead of every 30 frames. At very large
    // scenes a fixed 30-frame window can take many seconds, leaving FPS at 0
    // exactly when the measurement matters.
    const fpsElapsed = now - frameWindowStart;
    if (fpsElapsed >= 500) {
      fps = Math.round((frameCount * 1000) / fpsElapsed);
      frameCount = 0;
      frameWindowStart = now;
      // Keep interaction above 30 fps on software/weak GPUs by trading a little
      // internal resolution in aggregate views. It recovers when headroom exists.
      if ((blocks.length || slots.length) && !reduced && now - lastQualityChange > 1500) {
        if (fps < 30 && qualityScale > 0.55) {
          qualityScale = Math.max(0.55, qualityScale - 0.07);
          renderer.setPixelRatio(Math.min(qualityBase, qualityScale));
          lastQualityChange = now;
        } else if (fps > 54 && qualityScale < qualityBase) {
          qualityScale = Math.min(qualityBase, qualityScale + 0.04);
          renderer.setPixelRatio(Math.min(qualityBase, qualityScale));
          lastQualityChange = now;
        }
      }
      onStats?.(stats());
    }
  }

  /* ------------------------------------------------------------- resize */
  function resize() {
    const rect = stage.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const cap = window.innerWidth < 760 ? 1.4 : 1.8;
    // Adaptive resolution: a 500k overview is an intentional aggregate view,
    // so render slightly below CSS resolution instead of dropping frames.
    const softwareScale = softwareGl ? 0.8 : 1;
    const aggregateScale = blocks.length > 800 ? 0.72 : blocks.length > 0 ? 0.85 : 1;
    qualityBase = Math.min(cap, Math.max(0.55, (window.devicePixelRatio || 1) * softwareScale * aggregateScale));
    if (!qualityScale) qualityScale = qualityBase;
    qualityScale = Math.min(qualityScale, qualityBase);
    renderer.setPixelRatio(qualityScale);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);

  /* ------------------------------------------------------------ public API */
  const stats = () => ({
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    fps,
    mode,
    simDay,
    visible: visibleCount,
    tokens: tokens.length,
    racks: slots.length,
  });

  function focusPoint(x, y, z, radius = 16) {
    setView({ target: new THREE.Vector3(x, Math.max(1, y), z), radius });
  }

  function focusSlot(slot) {
    selectSlot(slot);
    const levelY = 0.78 + (slot.level || 0) * LEVEL_H;
    // Stand in the aisle beside the bay and look at the pallet, the way the
    // rack is actually inspected. Rack rows sit at a fixed pitch, so the aisle
    // centre is the midpoint to the neighbouring row.
    const rowXs = [...new Set(frames.filter((f) => f.band === slot.band).map((f) => f.x))].sort((a, b) => a - b);
    let aisleX = null;
    let best = Infinity;
    for (let i = 1; i < rowXs.length; i++) {
      const mid = (rowXs[i - 1] + rowXs[i]) / 2;
      const distance = Math.abs(mid - slot.x);
      if (distance < best) {
        best = distance;
        aisleX = mid;
      }
    }
    const dx = aisleX != null && best < 4 ? aisleX - slot.x : 1.7;
    const dz = 2.4;
    const target = new THREE.Vector3(slot.x, levelY - 0.04, slot.z);
    const position = new THREE.Vector3(slot.x + dx, levelY + 0.5, slot.z + dz);
    const radius = Math.max(2.1, position.distanceTo(target));
    setView({
      target,
      radius,
      theta: Math.atan2(position.x - target.x, position.z - target.z),
      phi: Math.min(1.36, Math.max(0.9, Math.acos((position.y - target.y) / radius))),
    });
  }

  const ZONE_VIEWS = {
    inbound: { target: new THREE.Vector3(-26, 2, -20), radius: 34, theta: 0.5, phi: 0.95 },
    storage: { target: new THREE.Vector3(0, 3, -2), radius: 64, theta: 0.62, phi: 0.95 },
    picking: { target: new THREE.Vector3(-8, 1.4, 13), radius: 30, theta: 0.35, phi: 1.02 },
    packing: { target: new THREE.Vector3(14, 1.4, 17), radius: 24, theta: -0.4, phi: 1.0 },
    outbound: { target: new THREE.Vector3(24, 1.6, 23), radius: 32, theta: -0.65, phi: 1.0 },
    inactive: { target: new THREE.Vector3(-43, 2, 11), radius: 22, theta: 0.9, phi: 1.0 },
  };

  let onMonth = null;
  let onStats = null;
  let lastAutoExpand = 0;
  const autoExpanded = new Set();

  const api = {
    setMode(next) {
      mode = next;
      applyLayout();
      if (next === "heatmap") setView({ radius: 64, theta: 0.62, phi: 0.72 });
      if (next === "abc") setView({ radius: 62, theta: 0.55, phi: 0.9 });
      onMode?.(next);
    },
    setFilter(next) {
      filter = { ...filter, ...next };
      applyLayout();
    },
    setStatuses(statusMap) {
      if (!statusMap) return;
      for (const slot of slots) {
        if (statusMap[slot.sku]) slot.status = statusMap[slot.sku];
      }
      applyLayout();
    },
    setMonth(value) {
      month = Math.min(12, Math.max(1, Number(value) || 12));
    },
    setSimulation(run) {
      simRun = run || null;
      tokens.length = 0;
      simDay = 0;
      if (simRun) applySimDay(0, false);
    },
    applySimDay(index, animate) {
      return applySimDay(index, animate !== false);
    },
    setPaused(next) {
      paused = Boolean(next);
      if (paused) renderer.render(scene, camera);
    },
    setSpeed(value) {
      speed = Math.max(0.25, Math.min(3, Number(value) || 1));
    },
    play() {
      playing = true;
      paused = false;
    },
    pause() {
      playing = false;
    },
    reset() {
      playing = false;
      tokens.length = 0;
      simRun = null;
      simDay = 0;
      for (const slot of slots) {
        slot.stock = initialStock.get(slot.sku) ?? 0;
        slot.pallets = Math.min(4, slot.stock > 0 ? Math.ceil(slot.stock / unit) : 0);
        slot.fill = slot.stock > 0 ? Math.min(1, Math.max(0.12, ((slot.stock % unit) || unit) / unit)) : 0;
        onStock?.(slot.sku, slot.stock);
      }
      month = 12;
      simClock = 0;
      applyLayout();
      renderer.render(scene, camera);
    },
    focusSku(sku) {
      const slot = slotBySku.get(sku);
      if (!slot) return false;
      focusSlot(slot);
      return true;
    },
    selectSku(sku) {
      const slot = slotBySku.get(sku);
      if (!slot) return false;
      selectSlot(slot);
      return true;
    },
    resetView() {
      currentAisle = -1;
      onAisle?.(null);
      setView(OVERVIEW);
    },
    stepAisle(direction) {
      stepAisle(Number(direction) || 1);
    },
    zoom(factor) {
      view.goal.radius = clampRadius(view.goal.radius * (Number(factor) || 1));
    },
    setAisleHook(fn) {
      onAisle = fn;
    },
    showClusterDetails,
    focusAt(point, radius = 15) {
      if (!point) return false;
      focusMarker.position.set(point.x, 0.3 + (point.level ?? 0) * LEVEL_H, point.z);
      focusMarker.visible = true;
      focusPoint(point.x, 1.6 + (point.level ?? 0) * LEVEL_H, point.z, radius);
      return true;
    },
    focusZone(zone) {
      if (zone === "all") {
        setView(OVERVIEW);
        return;
      }
      const preset = ZONE_VIEWS[zone];
      if (preset) setView(preset);
    },
    overview() {
      setView(OVERVIEW);
    },
    onMonth(fn) {
      onMonth = fn;
    },
    setStatsHook(fn) {
      onStats = fn;
    },
    stats,
    get simDay() {
      return simDay;
    },
    frame: resize,
    renderOnce() {
      renderer.render(scene, camera);
      return stats();
    },
    dispose() {
      loopRunning = false;
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };

  if (slots.length === 0) {
    palletMesh.visible = false;
    cartonMesh.visible = false;
    hitMesh.visible = false;
    pickHitMesh.visible = false;
    tokenMesh.visible = false;
  }

  if (reduced) {
    paused = true;
    onStats?.(stats());
  }
  requestAnimationFrame(tick);
  return api;
}

/* -------------------------------------------------------------- textures */
/** Carton board with the XYZ pattern printed over it, so the close-up load
 *  keeps both the material grain and the classification cue. */
function makeLoadTextures() {
  const build = (kind) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
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
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  return { smooth: build("smooth"), striped: build("striped"), dotted: build("dotted") };
}

function makePatternTextures() {
  const build = (kind) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
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
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
  };
  return {
    smooth: build("smooth"),
    striped: build("striped"),
    dotted: build("dotted"),
  };
}

function dominantStatus(status) {
  const entries = Object.entries(status || {}).sort((a, b) => b[1] - a[1]);
  return entries[0] ? entries[0][0] : "balanced";
}
