// Neon Shores — pedestrians: walkers on the sidewalks who flee crimes.
//
// INTERFACE (what main.js / the next session wires against):
//   new PedestrianManager(scene, city, rng)
//   manager.peds         -> Ped[] (28)
//   manager.update(dt, world)
//   manager.scare(x, z, radius)          // everyone in radius flees
//   manager.nearestPed(pos, maxDist, heading?, minDot?)
//     -> nearest Ped within maxDist; if heading is given, only peds in front
//        of that heading (dot >= minDot, default 0.5)
//   Ped: group, health, state ('walk' | 'flee' | 'down')
//   Ped.hit(dmg) -> true if killed
//   Ped.scareFrom(x, z)

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, roadCoord } from './config.js';

const SHIRTS = [0xc23b2e, 0x2e6fc2, 0xe8b73a, 0x7a4a9e, 0x2fae5f, 0xd46a2a, 0xe8e8e8, 0x8a6b4a];
const SKINS = [0xd9a066, 0x8a5a3a, 0xe8b88a, 0x6b4426];

// A random point on a sidewalk: pick a road, a spot along it, either side.
function sidewalkPoint(city, rng) {
  const vertical = rng.chance(0.5);
  const road = roadCoord(rng.randInt(0, 8));
  const along = rng.rand(-260, 260);
  const off = (CONFIG.world.roadWidth / 2 + CONFIG.world.sidewalk / 2) * (rng.chance(0.5) ? 1 : -1);
  return vertical ? { x: road + off, z: along } : { x: along, z: road + off };
}

export class Ped {
  constructor(scene, city, rng) {
    this.city = city;
    this.rng = rng;
    this.health = 100;
    this.state = 'walk';
    this.heading = rng.rand(0, Math.PI * 2);
    this.speed = 0;
    this.fleeTimer = 0;
    this.downTimer = 0;
    this.target = sidewalkPoint(city, rng);
    this.fleeDir = { x: 1, z: 0 };

    this.group = new THREE.Group();
    const shirt = new THREE.MeshLambertMaterial({ color: rng.pick(SHIRTS) });
    const skin = new THREE.MeshLambertMaterial({ color: rng.pick(SKINS) });
    const pants = new THREE.MeshLambertMaterial({ color: 0x2a2a30 });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.95, 0.36), shirt);
    this.body.position.y = 0.95;
    this.body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
    head.position.y = 1.62;
    head.castShadow = true;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), pants);
    legL.position.set(-0.16, 0.38, 0);
    const legR = legL.clone();
    legR.position.x = 0.16;
    this.group.add(this.body, head, legL, legR);
    const p = sidewalkPoint(city, rng);
    this.group.position.set(p.x, 0, p.z);
    this.group.rotation.y = this.heading;
    scene.add(this.group);
  }

  hit(dmg) {
    this.health -= dmg;
    if (this.health <= 0) {
      this.state = 'down';
      this.downTimer = 3;
      this.group.rotation.z = Math.PI / 2; // lying on the ground
      return true;
    }
    this.state = 'flee';
    this.fleeTimer = 3;
    return false;
  }

  scareFrom(x, z) {
    if (this.state === 'down') return;
    const dx = this.group.position.x - x;
    const dz = this.group.position.z - z;
    const d = Math.hypot(dx, dz) || 1;
    this.fleeDir = { x: dx / d, z: dz / d };
    this.state = 'flee';
    this.fleeTimer = 3;
  }

  update(dt) {
    const pos = this.group.position;
    if (this.state === 'down') {
      this.downTimer -= dt;
      if (this.downTimer <= 0) {
        this.group.rotation.z = 0;
        this.scareFrom(pos.x, pos.z - 1); // get up and run
      }
      return;
    }
    let tx;
    let tz;
    let spd;
    if (this.state === 'flee') {
      this.fleeTimer -= dt;
      tx = pos.x + this.fleeDir.x * 10;
      tz = pos.z + this.fleeDir.z * 10;
      spd = CONFIG.peds.fleeSpeed;
      if (this.fleeTimer <= 0) {
        this.state = 'walk';
        this.target = sidewalkPoint(this.city, this.rng);
      }
    } else {
      tx = this.target.x;
      tz = this.target.z;
      spd = CONFIG.peds.walkSpeed;
      if (Math.hypot(tx - pos.x, tz - pos.z) < 2) {
        this.target = sidewalkPoint(this.city, this.rng);
        return;
      }
    }
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(dx, dz);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += dh * Math.min(1, 8 * dt);
    this.group.rotation.y = this.heading;
    const step = Math.min(d, spd * dt);
    const nx = pos.x + (dx / d) * step;
    const nz = pos.z + (dz / d) * step;
    if (!this.city.collide(nx, nz, 0.5)) {
      pos.x = nx;
      pos.z = nz;
    } else {
      this.target = sidewalkPoint(this.city, this.rng); // blocked: pick a new walk
    }
    this.speed = spd;
  }
}

export class PedestrianManager {
  constructor(scene, city, rng) {
    this.city = city;
    this.rng = rng;
    this.peds = [];
    for (let i = 0; i < CONFIG.peds.count; i++) {
      this.peds.push(new Ped(scene, city, rng));
    }
  }

  update(dt) {
    for (const ped of this.peds) ped.update(dt);
  }

  scare(x, z, radius) {
    for (const ped of this.peds) {
      const d = Math.hypot(ped.group.position.x - x, ped.group.position.z - z);
      if (d < radius) ped.scareFrom(x, z);
    }
  }

  nearestPed(pos, maxDist, heading, minDot = 0.5) {
    let best = null;
    let bestD = maxDist;
    const hasHeading = typeof heading === 'number';
    for (const ped of this.peds) {
      if (ped.state === 'down') continue;
      const dx = ped.group.position.x - pos.x;
      const dz = ped.group.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      if (hasHeading && d > 0.01) {
        const dot = (dx * Math.sin(heading) + dz * Math.cos(heading)) / d;
        if (dot < minDot) continue;
      }
      bestD = d;
      best = ped;
    }
    return best;
  }
}
