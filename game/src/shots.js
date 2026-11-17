// Neon Shores — the four deterministic screenshot scenes.
// ?shot=<name>&seed=N stages the game into a good frame: the player, traffic,
// pedestrians and (for the chase) police are placed with the game's own live
// units, the world is simulated forward a fixed number of steps, and then the
// frame is ready. main.js sets window.__shotReady after the first render.
//
// INTERFACE (what main.js wires against):
//   stageShot(name, G, seed)
//     G: { city, player, vehicles, peds, police, missions,
//          tick(dt, input) }  // G.tick advances the simulation one step
//     name: 'street' | 'drive' | 'chase' | 'mission'
//   The scenes use the live traffic cars and pedestrians — nothing is faked.

import { makeRng } from './random.js';
import { CONFIG } from './config.js';

const STEP = 1 / 60;
const LANE = CONFIG.car.laneOffset; // 3.2 m right-hand lane offset
const SIDE = CONFIG.world.roadWidth / 2 + CONFIG.world.sidewalk / 2; // 9 m

// Which road runs through (x, z)? -> { vertical: bool, c: centreline } | null
function roadThrough(city, x, z) {
  for (let i = 0; i <= CONFIG.world.gridN; i++) {
    const c = city.roadCoord(i);
    if (Math.abs(x - c) <= CONFIG.world.roadWidth / 2) return { vertical: true, c };
    if (Math.abs(z - c) <= CONFIG.world.roadWidth / 2) return { vertical: false, c };
  }
  return null;
}

function nearestNode(city, x, z) {
  let best = 0;
  let bestD = Infinity;
  city.roadGraph.nodes.forEach((n, i) => {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Dress the road around (cx, cz) with live traffic in both lanes and
// pedestrians on both sidewalks, so the frame never looks empty.
function dressRoad(G, cx, cz, rng) {
  const { city, vehicles, peds, player } = G;
  const road = roadThrough(city, cx, cz);
  if (!road) return;
  const px = player.pos.x;
  const pz = player.pos.z;

  // --- traffic: both lanes, both directions, ahead and behind ---
  const traffic = vehicles.cars.filter((c) => c.isTraffic && !c.driver);
  const offsets = [-48, -26, 14, 30, 52, -64];
  let placed = 0;
  for (const car of traffic) {
    if (placed >= 6) break;
    const off = offsets[placed % offsets.length];
    const lane = placed % 2 === 0 ? -LANE : LANE;
    let x;
    let z;
    let heading;
    if (road.vertical) {
      x = road.c + lane;
      z = cz + off;
      heading = off >= 0 ? 0 : Math.PI;
    } else {
      x = cx + off;
      z = road.c + lane;
      heading = off >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (Math.hypot(x - px, z - pz) < 9) continue; // keep the player clear
    car.group.position.set(x, 0, z);
    car.heading = heading;
    car.group.rotation.y = heading;
    car.speed = CONFIG.car.trafficSpeed;
    car.parked = false;
    // re-anchor the traffic AI to the nearest intersection
    const node = nearestNode(city, x, z);
    car.node = node;
    const n = city.roadGraph.nodes[node];
    const go = road.vertical
      ? (heading === 0 ? [0, 1] : [0, -1])
      : (heading === Math.PI / 2 ? [1, 0] : [-1, 0]);
    const next = city.roadGraph.nodeAt(n.i + go[0], n.j + go[1]);
    car.next = next >= 0 ? next : city.roadGraph.neighbors(node)[0];
    placed++;
  }

  // --- pedestrians: both sidewalks, flanking the road ---
  const sideOffsets = [-32, -12, 16, 36, -48, 52];
  let pPlaced = 0;
  for (const ped of peds.peds) {
    if (pPlaced >= 6) break;
    const off = sideOffsets[pPlaced % sideOffsets.length];
    const side = pPlaced % 2 === 0 ? -SIDE : SIDE;
    let x;
    let z;
    if (road.vertical) { x = road.c + side; z = cz + off; }
    else { x = cx + off; z = road.c + side; }
    if (Math.hypot(x - px, z - pz) < 6) continue;
    ped.group.position.set(x, 0, z);
    ped.state = 'walk';
    ped.target = road.vertical
      ? { x: road.c + side, z: z + (rng.chance(0.5) ? 40 : -40) }
      : { x: x + (rng.chance(0.5) ? 40 : -40), z: road.c + side };
    pPlaced++;
  }
}

// Move any pedestrian standing in the road corridor ahead of the player onto
// the nearest sidewalk (from the chase camera they read as standing on a car).
function clearRoadAhead(G, heading, range = 45) {
  const { city, peds, player } = G;
  const px = player.pos.x;
  const pz = player.pos.z;
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  for (const ped of peds.peds) {
    const dx = ped.group.position.x - px;
    const dz = ped.group.position.z - pz;
    const along = dx * fx + dz * fz;
    const across = Math.abs(dx * fz - dz * fx);
    if (along > 0 && along < range && across < 5) {
      const road = roadThrough(city, ped.group.position.x, ped.group.position.z);
      if (!road) continue;
      const side = (ped.group.position.x - road.c) >= 0 || !road.vertical ? SIDE : -SIDE;
      if (road.vertical) ped.group.position.x = road.c + side;
      else ped.group.position.z = road.c + side;
      ped.state = 'walk';
    }
  }
}

function walkSouth(G, seconds, camHeading) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) G.tick(STEP, { f: true, camHeading });
}

function driveForward(G, seconds) {
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) G.tick(STEP, { f: true, camHeading: 0 });
}

function stealNearestParked(G) {
  const { player, vehicles } = G;
  const car = vehicles.cars.find((c) => c.parked && !c.driver) || vehicles.nearestCar(player.pos, 400);
  if (!car) return null;
  car.group.position.set(0, 0, -200);
  car.heading = 0;
  car.group.rotation.y = 0;
  car.speed = 0;
  player.pos.set(3, 0, -200);
  player.heading = Math.PI / 2;
  player.group.rotation.y = player.heading;
  player.tryEnterCar(vehicles);
  return car;
}

export function stageShot(name, G, seed) {
  const rng = makeRng(seed);
  const { city, player, vehicles, peds, police, missions } = G;

  if (name === 'street') {
    // Rico on foot downtown, walking south down road x=0.
    missions.setMission(0);
    player.pos.set(0, 0, -200);
    player.heading = 0;
    player.group.rotation.y = 0;
    walkSouth(G, 8, 0);
    dressRoad(G, player.pos.x, player.pos.z, rng);
    clearRoadAhead(G, player.heading);
  } else if (name === 'drive') {
    // Rico driving the stolen car south down road x=0 at ~108 km/h.
    missions.setMission(0);
    const car = stealNearestParked(G);
    player.wanted = 0; // a clean drive, no police in frame
    driveForward(G, 8);
    if (car) car.speed = 30; // 108 km/h on the speedo
    dressRoad(G, player.pos.x, player.pos.z, rng);
    clearRoadAhead(G, player.heading);
  } else if (name === 'chase') {
    // Wanted 3: Rico driving south, a patrol car closing in the oncoming lane.
    missions.setMission(0);
    const car = stealNearestParked(G);
    driveForward(G, 6);
    if (car) car.speed = 30;
    // dress the road BEFORE the police teleport in, so no traffic car
    // lands on top of the patrol car
    dressRoad(G, player.pos.x, player.pos.z, rng);
    const roadX = 0;
    const ahead = { x: roadX + LANE, z: player.pos.z + 32 };
    police.forceChase(3, ahead);
    // an officer on the sidewalk ahead
    police.spawnOfficerAt(roadX + SIDE + 1, player.pos.z + 25);
    const n = Math.round(0.4 / STEP);
    for (let i = 0; i < n; i++) G.tick(STEP, { f: true, camHeading: 0 });
    clearRoadAhead(G, player.heading);
  } else if (name === 'mission') {
    // Rico on foot walking north up the boardwalk road toward the beacon.
    missions.setMission(0);
    missions.stage = 1; // target: the boardwalk pickup
    player.pos.set(280, 0, 10);
    player.heading = Math.PI; // north (-z)
    player.group.rotation.y = Math.PI;
    // a parked car waiting beside the beacon
    const parked = vehicles.cars.find((c) => c.parked && !c.driver);
    if (parked) {
      parked.group.position.set(274, 0, -78);
      parked.heading = Math.PI / 2;
      parked.group.rotation.y = Math.PI / 2;
    }
    walkSouth(G, 11, Math.PI);
    dressRoad(G, player.pos.x, player.pos.z, rng);
    clearRoadAhead(G, player.heading);
  } else {
    // unknown scene: leave the world as it spawned
    dressRoad(G, player.pos.x, player.pos.z, rng);
  }
}
