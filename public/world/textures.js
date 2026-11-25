/**
 * Procedural surface detail for the two warehouse scenes.
 *
 * Both 3D views are instanced box geometry. A flat colour reads as plastic; a
 * light grain, fibre and tape overlay is enough to read as corrugated board and
 * timber without shipping image assets or adding draw calls. The textures are
 * neutral so the per-instance status colour still decides the hue.
 */
import * as THREE from "/vendor/three/three.module.js";

function canvas(size) {
  const node = document.createElement("canvas");
  node.width = size;
  node.height = size;
  return node;
}

/** Corrugated board: paper fibre, flute lines, a tape strip and worn edges. */
export function cardboardTexture(repeat = 1) {
  const node = canvas(128);
  const ctx = node.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#f4f0e8";
  ctx.fillRect(0, 0, 128, 128);

  // Fibre noise, deterministic so both scenes look identical.
  for (let i = 0; i < 2600; i++) {
    const x = (i * 73) % 128;
    const y = (i * 47) % 128;
    const shade = 224 + ((i * 37) % 26);
    ctx.fillStyle = `rgba(${shade},${shade - 6},${shade - 16},0.5)`;
    ctx.fillRect(x, y, 1, 1);
  }
  // Horizontal flute hint, the strongest cue for corrugated board.
  ctx.strokeStyle = "rgba(150,140,125,0.16)";
  ctx.lineWidth = 1;
  for (let y = 6; y < 128; y += 9) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }
  // Packing tape across the middle of the top face.
  ctx.fillStyle = "rgba(232,228,214,0.55)";
  ctx.fillRect(0, 54, 128, 16);
  ctx.fillStyle = "rgba(120,110,96,0.18)";
  ctx.fillRect(0, 54, 128, 1);
  ctx.fillRect(0, 69, 128, 1);
  // Edge wear.
  ctx.strokeStyle = "rgba(120,108,90,0.22)";
  ctx.strokeRect(0.5, 0.5, 127, 127);

  const texture = new THREE.CanvasTexture(node);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

/** Timber: grain lines, a few knots and a darker end grain. */
export function woodTexture(repeat = 1) {
  const node = canvas(128);
  const ctx = node.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#9a7549";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 42; i++) {
    const y = (i * 128) / 42;
    ctx.strokeStyle = i % 3 === 0 ? "rgba(88,62,34,0.35)" : "rgba(120,89,52,0.3)";
    ctx.lineWidth = i % 5 === 0 ? 2 : 1;
    ctx.beginPath();
    for (let x = 0; x <= 128; x += 4) {
      const wobble = Math.sin((x + i * 9) * 0.14) * 1.6;
      if (x === 0) ctx.moveTo(x, y + wobble);
      else ctx.lineTo(x, y + wobble);
    }
    ctx.stroke();
  }
  for (const [x, y, r] of [
    [34, 55, 4],
    [96, 88, 3],
    [77, 22, 2],
  ]) {
    ctx.strokeStyle = "rgba(74,50,26,0.55)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.8, r, 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(node);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}
