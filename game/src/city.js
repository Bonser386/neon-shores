// Neon Shores — the city of Solmar.
// 8x8 road grid with five districts, procedural canvas textures, a road graph
// for traffic AI, and AABB colliders for buildings.
//
// INTERFACE (what the next session wires against):
//   buildCity(scene, rng) -> {
//     group,                 // THREE.Group holding all city meshes
//     colliders,             // [{ x, z, hx, hz }] axis-aligned boxes
//     roadGraph: {
//       nodes,               // [{ x, z, i, j }] 9x9 intersections, index = j*9+i
//       nodeAt(i, j),        // -> node index or -1
//       neighbors(idx),      // -> [node indices] adjacent intersections
//     },
//     spawnPoints: {
//       player,              // { x, z, heading } Rico's start
//       boardwalk,           // { x, z } mission 1 pickup
//       chopShop,            // { x, z } mission 2 delivery
//       docks,               // { x, z } mission 5 delivery
//       goldCoupe,           // { x, z } where the gold coupe is parked
//       cashDrops,           // [{ x, z }] x5 mission 4 pickups
//     },
//     isOnRoad(x, z),        // -> bool
//     nearestRoadPoint(x, z),// -> { x, z } closest point on a road centreline
//     collide(x, z, r),      // -> bool, circle vs building AABBs
//     roadCoord(i),          // road centreline coordinate
//   }
//
// Districts (by block centre): north = downtown, east = beach, south = port,
// west = suburbs, centre = midtown. North is -z, east is +x.

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, roadCoord } from './config.js';

const W = CONFIG.world;
const C = CONFIG.colors;

// ---------------------------------------------------------------------------
// canvas textures (fall back to plain colour when there is no document, e.g.
// the Node smoke test — the game still builds, just untextured)
// ---------------------------------------------------------------------------
function canvasTexture(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildingTexture(base, litRatio, rows, cols) {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // grime at the base
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - 18, w, 18);
    const cw = w / cols;
    const ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = Math.random() < litRatio;
        ctx.fillStyle = lit
          ? (Math.random() < 0.5 ? '#ffd27a' : '#ff9e57')
          : '#20242e';
        ctx.fillRect(c * cw + cw * 0.22, r * ch + ch * 0.25, cw * 0.56, ch * 0.5);
      }
    }
  });
}

function sidewalkTexture() {
  // Pale paving slabs: speckle + joint lines, so the sidewalk reads as
  // pavement instead of a flat tan plane (it fills the bottom of the frame
  // in the chase camera, so it must not look like a void).
  const t = canvasTexture(128, 64, (ctx, w, h) => {
    ctx.fillStyle = '#8d8578';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#7a7263' : '#9d9484';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    ctx.fillStyle = '#6e6658';
    ctx.fillRect(0, 0, 2, h);
    ctx.fillRect(w / 2, 0, 2, h);
    ctx.fillRect(0, 0, w, 2);
    ctx.fillRect(0, h - 2, w, 2);
  });
  if (t) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return t;
}

function roadTexture() {
  // U axis = along the road, V axis = across it. Dashes and edge lines run
  // ALONG the road (horizontal in canvas space = along the road's length).
  const t = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(0, 0, w, h);
    // asphalt speckle
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? '#3d4046' : '#565a61';
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // edge lines, running along the road
    ctx.fillStyle = '#d8d8c8';
    ctx.fillRect(0, 3, w, 3);
    ctx.fillRect(0, h - 6, w, 3);
    // centre dashes, running along the road
    ctx.fillStyle = '#e8b73a';
    ctx.fillRect(20, h / 2 - 2, 90, 4);
    ctx.fillRect(150, h / 2 - 2, 90, 4);
  });
  if (t) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return t;
}

// ---------------------------------------------------------------------------
// city
// ---------------------------------------------------------------------------
export function buildCity(scene, rng) {
  const group = new THREE.Group();
  group.name = 'solmar';
  const colliders = [];

  const roadTex = roadTexture();
  const roadMat = roadTex
    ? new THREE.MeshLambertMaterial({ map: roadTex })
    : new THREE.MeshLambertMaterial({ color: C.road });
  const sidewalkTex = sidewalkTexture();
  const sidewalkMat = sidewalkTex
    ? new THREE.MeshLambertMaterial({ map: sidewalkTex })
    : new THREE.MeshLambertMaterial({ color: C.sidewalk });
  const groundMat = new THREE.MeshLambertMaterial({ color: C.ground });
  const oceanMat = new THREE.MeshLambertMaterial({ color: C.ocean });
  const boardwalkMat = new THREE.MeshLambertMaterial({ color: C.boardwalk });

  const towerTex = buildingTexture('#3d3d4e', 0.55, 16, 6);
  const midTex = buildingTexture('#4a3d36', 0.45, 10, 5);
  const houseTex = buildingTexture('#5d4c3a', 0.35, 2, 4);
  const portTex = buildingTexture('#3d4652', 0.25, 3, 6);
  const towerMat = new THREE.MeshLambertMaterial({ map: towerTex || undefined, color: towerTex ? 0xffffff : C.buildingDowntown });
  const midMat = new THREE.MeshLambertMaterial({ map: midTex || undefined, color: midTex ? 0xffffff : C.buildingMidtown });
  const houseMat = new THREE.MeshLambertMaterial({ map: houseTex || undefined, color: houseTex ? 0xffffff : C.buildingHouse });
  const portMat = new THREE.MeshLambertMaterial({ map: portTex || undefined, color: portTex ? 0xffffff : C.buildingPort });
  const containerMats = [0xb8442c, 0x2c6bb8, 0x3d8a44, 0xc8a02c].map(
    (c) => new THREE.MeshLambertMaterial({ color: c }),
  );
  const palmTrunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const palmCrownMat = new THREE.MeshLambertMaterial({ color: 0x2f7a3d });
  const craneMat = new THREE.MeshLambertMaterial({ color: 0xc8a02c });
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe9a8, emissive: 0xffc860, emissiveIntensity: 0.9 });

  const addBox = (mat, w, h, d, x, y, z, collide = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = h > 4;
    m.receiveShadow = true;
    group.add(m);
    if (collide) colliders.push({ x, z, hx: w / 2, hz: d / 2 });
    return m;
  };

  // ---- ground, ocean, boardwalk ----
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  group.add(ground);

  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(300, 900), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(312 + 150, 0.02, 0);
  group.add(ocean);

  const boardwalk = new THREE.Mesh(new THREE.PlaneGeometry(20, 560), boardwalkMat);
  boardwalk.rotation.x = -Math.PI / 2;
  boardwalk.position.set(302, 0.08, 0);
  boardwalk.receiveShadow = true;
  group.add(boardwalk);

  // ---- roads + sidewalks ----
  const roadLen = W.half * 2 + W.roadWidth; // 574
  if (roadTex) roadTex.repeat.set(roadLen / 28, 1); // one dash tile per 28 m
  if (sidewalkTex) sidewalkTex.repeat.set(roadLen / 4, 1); // one 4 m slab tile
  for (let i = 0; i <= W.gridN; i++) {
    const c = roadCoord(i);
    // road along X (varying x, fixed z)
    const rx = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, W.roadWidth), roadMat);
    rx.rotation.x = -Math.PI / 2;
    rx.position.set(0, 0, c);
    rx.receiveShadow = true;
    group.add(rx);
    // road along Z (varying z, fixed x)
    const rz = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, W.roadWidth), roadMat);
    rz.rotation.x = -Math.PI / 2;
    rz.rotation.z = Math.PI / 2;
    rz.position.set(c, 0.01, 0);
    rz.receiveShadow = true;
    group.add(rz);
    // sidewalks: strips along both sides of each road
    for (const s of [-1, 1]) {
      const off = (W.roadWidth / 2 + W.sidewalk / 2) * s;
      const sx = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, W.sidewalk), sidewalkMat);
      sx.rotation.x = -Math.PI / 2;
      sx.position.set(0, 0.06, c + off);
      sx.receiveShadow = true;
      group.add(sx);
      const sz = new THREE.Mesh(new THREE.PlaneGeometry(roadLen, W.sidewalk), sidewalkMat);
      sz.rotation.x = -Math.PI / 2;
      sz.rotation.z = Math.PI / 2;
      sz.position.set(c + off, 0.06, 0);
      sz.receiveShadow = true;
      group.add(sz);
    }
  }

  // ---- buildings, per block ----
  const district = (cx, cz) => {
    if (cz > 140) return 'port';
    if (cx > 140) return 'beach';
    if (cz < -140) return 'downtown';
    if (cx < -140) return 'suburbs';
    return 'midtown';
  };
  const jitter = (v) => v + rng.rand(-3, 3);

  for (let bi = 0; bi < W.gridN; bi++) {
    for (let bj = 0; bj < W.gridN; bj++) {
      const cx = -W.half + (bi + 0.5) * W.spacing;
      const cz = -W.half + (bj + 0.5) * W.spacing;
      const d = district(cx, cz);
      if (d === 'downtown') {
        for (const [ox, oz] of [[-12, -12], [12, -12], [0, 12]]) {
          const w = rng.rand(13, 18);
          const h = rng.rand(42, 92);
          addBox(towerMat, w, h, w, jitter(cx + ox), h / 2, jitter(cz + oz), true);
        }
      } else if (d === 'midtown') {
        for (const [ox, oz] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, 0]]) {
          const w = rng.rand(10, 14);
          const h = rng.rand(15, 35);
          addBox(midMat, w, h, w, jitter(cx + ox), h / 2, jitter(cz + oz), true);
        }
      } else if (d === 'suburbs') {
        for (const [ox, oz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
          const w = rng.rand(8, 11);
          const h = rng.rand(6, 10);
          addBox(houseMat, w, h, w * 1.2, jitter(cx + ox), h / 2, jitter(cz + oz), true);
        }
      } else if (d === 'beach') {
        for (const [ox, oz] of [[-10, -10], [10, 10]]) {
          const w = rng.rand(15, 19);
          const h = rng.rand(20, 36);
          addBox(midMat, w, h, w * 0.8, jitter(cx + ox), h / 2, jitter(cz + oz), true);
        }
        // palms in the block
        for (let p = 0; p < 3; p++) {
          palmAt(cx + rng.rand(-18, 18), cz + rng.rand(-18, 18));
        }
      } else {
        // port: warehouse + container stacks
        addBox(portMat, 26, 12, 15, jitter(cx), 6, jitter(cz - 8), true);
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          const px = cx - 16 + sIdx * 11;
          const pz = cz + 14;
          const stack = rng.randInt(1, 2);
          for (let s = 0; s < stack; s++) {
            addBox(rng.pick(containerMats), 6, 2.6, 2.6, jitter(px), 1.3 + s * 2.6, jitter(pz), s === 0);
          }
        }
      }
    }
  }

  function palmAt(x, z) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 6, 6), palmTrunkMat);
    trunk.position.set(x, 3, z);
    group.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), palmCrownMat);
    crown.scale.y = 0.45;
    crown.position.set(x, 6.4, z);
    group.add(crown);
  }

  // boardwalk palms
  for (let z = -260; z <= 260; z += 52) palmAt(296, z + rng.rand(-6, 6));

  // ---- port cranes ----
  for (const cx of [-140, 0, 140]) {
    const cz = 252;
    addBox(craneMat, 2, 26, 2, cx - 8, 13, cz);
    addBox(craneMat, 2, 26, 2, cx + 8, 13, cz);
    addBox(craneMat, 40, 2.5, 2.5, cx, 26, cz);
    addBox(craneMat, 2, 6, 2, cx + 14, 22, cz); // hanging hook block
  }

  // ---- streetlights at every other intersection ----
  for (let i = 0; i <= W.gridN; i += 2) {
    for (let j = 0; j <= W.gridN; j += 2) {
      if ((i + j) % 4 !== 0) continue;
      const x = roadCoord(i) + W.roadWidth / 2 + 1;
      const z = roadCoord(j) + W.roadWidth / 2 + 1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), poleMat);
      pole.position.set(x, 3.5, z);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat);
      lamp.position.set(x, 7.1, z);
      group.add(lamp);
    }
  }

  scene.add(group);

  // ---- road graph: 9x9 intersections ----
  const nodes = [];
  for (let j = 0; j <= W.gridN; j++) {
    for (let i = 0; i <= W.gridN; i++) {
      nodes.push({ x: roadCoord(i), z: roadCoord(j), i, j });
    }
  }
  const nodeAt = (i, j) => (i < 0 || j < 0 || i > W.gridN || j > W.gridN ? -1 : j * (W.gridN + 1) + i);
  const neighbors = (idx) => {
    const n = nodes[idx];
    const out = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = nodeAt(n.i + di, n.j + dj);
      if (k >= 0) out.push(k);
    }
    return out;
  };

  // ---- queries ----
  const isOnRoad = (x, z) => {
    if (x < -W.half - 20 || x > W.half + 40 || z < -W.half - 20 || z > W.half + 20) return false;
    for (let i = 0; i <= W.gridN; i++) {
      if (Math.abs(x - roadCoord(i)) <= W.roadWidth / 2) return true;
      if (Math.abs(z - roadCoord(i)) <= W.roadWidth / 2) return true;
    }
    return false;
  };

  const nearestRoadPoint = (x, z) => {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i <= W.gridN; i++) {
      const c = roadCoord(i);
      // point on vertical road x=c (clamped z)
      const dV = Math.abs(x - c);
      if (dV < bestD) { bestD = dV; best = { x: c, z: Math.max(-W.half, Math.min(W.half, z)) }; }
      const dH = Math.abs(z - c);
      if (dH < bestD) { bestD = dH; best = { x: Math.max(-W.half, Math.min(W.half, x)), z: c }; }
    }
    return best;
  };

  const collide = (x, z, r) => {
    for (const b of colliders) {
      const cx = Math.max(b.x - b.hx, Math.min(x, b.x + b.hx));
      const cz = Math.max(b.z - b.hz, Math.min(z, b.z + b.hz));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  };

  // ---- mission / spawn points (snapped to roads where it matters) ----
  const snap = (x, z) => nearestRoadPoint(x, z);
  const spawnPoints = {
    player: { x: 0, z: -200, heading: 0 },
    boardwalk: { x: 282, z: -70 },
    chopShop: snap(-245, 70),
    docks: snap(-70, 262),
    goldCoupe: { x: 150, z: -130 },
    cashDrops: [
      snap(140, -210),
      snap(-210, -70),
      snap(70, 0),
      snap(-70, 140),
      snap(210, 210),
    ],
  };

  return {
    group,
    colliders,
    roadGraph: { nodes, nodeAt, neighbors },
    spawnPoints,
    isOnRoad,
    nearestRoadPoint,
    collide,
    roadCoord,
  };
}
