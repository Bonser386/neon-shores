// Neon Shores — the Solmar PD: wanted level, pursuit, busts.
//
// The wanted level lives on the player (player.wanted, a float 0..5).
// This module owns everything around it: patrol cars that chase and ram,
// foot officers who shoot and try to bust the player on foot, and the heat
// decay that cools the stars off once the player stops committing crimes.
//
// INTERFACE (what main.js / shots.js wire against):
//   new Police(scene, city, rng, player, vehicles, audio?)
//   police.cars          -> Car[] currently on pursuit (black + light bar)
//   police.officers      -> [{ group, heading, shootTimer }] foot officers
//   police.busted        -> bool, set when the player is busted
//   police.sirenOn       -> bool, true while any unit is pursuing
//   police.update(dt)    // spawns/despawns units, steers pursuit, decays heat
//   police.reset()       // clear all units + wanted (after a bust/respawn)
//   police.forceChase(stars, ahead) // shots.js: wanted = stars, nearest unit
//                                  // teleported to `ahead` {x, z} (oncoming lane)
//   police.spawnOfficerAt(x, z)    // shots.js: one officer on the sidewalk
//   police.decayRate     -> stars per second (from CONFIG)

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { Car } from './vehicles.js';

const WANTED = CONFIG.wanted;
const WORLD = CONFIG.world;

// How long a bust takes once a unit is on top of a slow player (s).
const BUST_HOLD = 1.2;
// How long after the last crime before the stars start to fade (s).
const HEAT_GRACE = 8;

function angleTo(fromX, fromZ, toX, toZ) {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function turnToward(heading, want, maxTurn, dt) {
  let d = want - heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return heading + Math.max(-maxTurn * dt, Math.min(maxTurn * dt, d));
}

export class Police {
  constructor(scene, city, rng, player, vehicles, audio = null) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.player = player;
    this.vehicles = vehicles;
    this.audio = audio;
    this.cars = [];
    this.officers = [];
    this.busted = false;
    this.sirenOn = false;
    this.lastCrimeAt = -999;
    this.prevWanted = 0;
    this.bustTimer = 0;
    this.spawnTimer = 0;
    this.time = 0;
    this.decayRate = WANTED.decayPerSec;
  }

  // ---- units -------------------------------------------------------------

  makePatrolCar(x, z, heading) {
    // white body + navy stripe: a patrol car must read as one at a glance
    // from the chase camera behind it (a black one is indistinguishable
    // from traffic).
    const car = new Car(this.scene, {
      x, z, heading, color: 0xe8e8e8, traffic: false, parked: false,
    });
    // light bar: red left, blue right. Both stay visible; update() alternates
    // their brightness so the bar always reads as flashing police lights
    // instead of one light blinking out of the frame.
    const barGeo = new THREE.BoxGeometry(0.5, 0.22, 0.6);
    const red = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff2a22 }));
    red.position.set(-0.55, 1.58, -0.2);
    const blue = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x2a6bff }));
    blue.position.set(0.55, 1.58, -0.2);
    car.group.add(red, blue);
    car._lightR = red;
    car._lightB = blue;
    // a navy door stripe so it reads as a patrol car at a glance
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.22, 2.4),
      new THREE.MeshBasicMaterial({ color: 0x1a2f5e }),
    );
    stripe.position.set(0, 0.62, -0.3);
    car.group.add(stripe);
    return car;
  }

  makeOfficer(x, z) {
    const group = new THREE.Group();
    group.name = 'officer';
    const navy = new THREE.MeshLambertMaterial({ color: 0x1a2f5e });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x14161c });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), navy);
    body.position.y = 0.95;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
    head.position.y = 1.62;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.3, 0.12, 10), dark);
    cap.position.y = 1.82;
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), dark);
    legL.position.set(-0.16, 0.38, 0);
    const legR = legL.clone();
    legR.position.x = 0.16;
    group.add(body, head, cap, legL, legR);
    group.position.set(x, 0, z);
    this.scene.add(group);
    return { group, heading: 0, shootTimer: this.rng.rand(0.3, 1.2) };
  }

  spawnOfficerAt(x, z) {
    const off = this.makeOfficer(x, z);
    this.officers.push(off);
    return off;
  }

  spawnPatrolCar() {
    // a road point 70-100 m from the player, on the road graph
    const p = this.player.pos;
    for (let tries = 0; tries < 12; tries++) {
      const ang = this.rng.rand(0, Math.PI * 2);
      const dist = this.rng.rand(70, 100);
      const x = p.x + Math.sin(ang) * dist;
      const z = p.z + Math.cos(ang) * dist;
      const near = this.city.nearestRoadPoint(x, z);
      if (!near) continue;
      if (Math.hypot(near.x - p.x, near.z - p.z) < 45) continue;
      const car = this.makePatrolCar(near.x, near.z, angleTo(near.x, near.z, p.x, p.z));
      this.cars.push(car);
      return car;
    }
    return null;
  }

  removeCar(car) {
    this.scene.remove(car.group);
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  removeOfficer(off) {
    this.scene.remove(off.group);
    const i = this.officers.indexOf(off);
    if (i >= 0) this.officers.splice(i, 1);
  }

  reset() {
    for (const car of [...this.cars]) this.removeCar(car);
    for (const off of [...this.officers]) this.removeOfficer(off);
    this.player.wanted = 0;
    this.prevWanted = 0;
    this.busted = false;
    this.bustTimer = 0;
    this.sirenOn = false;
  }

  // shots.js: force a chase at `stars` and put the nearest unit in the
  // oncoming lane at `ahead` { x, z } (heading toward the player).
  forceChase(stars, ahead) {
    this.player.wanted = stars;
    this.prevWanted = stars;
    this.lastCrimeAt = this.time;
    const want = Math.min(5, Math.max(1, Math.ceil(stars)));
    while (this.cars.length < want) {
      const c = this.spawnPatrolCar();
      if (!c) break;
    }
    if (ahead && this.cars.length) {
      let best = this.cars[0];
      let bestD = Infinity;
      for (const c of this.cars) {
        const d = Math.hypot(c.group.position.x - ahead.x, c.group.position.z - ahead.z);
        if (d < bestD) { bestD = d; best = c; }
      }
      const p = this.player.pos;
      best.group.position.set(ahead.x, 0, ahead.z);
      best.heading = angleTo(ahead.x, ahead.z, p.x, p.z);
      best.group.rotation.y = best.heading;
      best.speed = 26;
    }
  }

  // ---- per-frame ----------------------------------------------------------

  update(dt) {
    this.time += dt;
    const player = this.player;
    if (player.dead) return;

    // a rising wanted level counts as a fresh crime
    if (player.wanted > this.prevWanted) this.lastCrimeAt = this.time;
    this.prevWanted = player.wanted;

    // heat decay: only once the player has been quiet for a while
    if (player.wanted > 0 && this.time - this.lastCrimeAt > HEAT_GRACE) {
      player.wanted = Math.max(0, player.wanted - WANTED.decayPerSec * dt);
    }

    const stars = Math.ceil(player.wanted);
    this.sirenOn = stars >= 1 && (this.cars.length > 0 || this.officers.length > 0);

    // ---- spawn / despawn ----
    const wantCars = Math.min(5, stars);
    if (this.cars.length < wantCars) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnPatrolCar();
        this.spawnTimer = 1.5;
      }
    }
    if (stars === 0) {
      for (const car of [...this.cars]) this.removeCar(car);
      for (const off of [...this.officers]) this.removeOfficer(off);
    }
    const wantOfficers = stars >= 2 ? Math.min(2, stars - 1) : 0;
    if (this.officers.length < wantOfficers) {
      const p = player.pos;
      const ang = this.rng.rand(0, Math.PI * 2);
      this.spawnOfficerAt(
        p.x + Math.sin(ang) * this.rng.rand(18, 28),
        p.z + Math.cos(ang) * this.rng.rand(18, 28),
      );
    } else if (this.officers.length > wantOfficers) {
      this.removeOfficer(this.officers[this.officers.length - 1]);
    }

    // ---- pursuit ----
    const px = player.pos.x;
    const pz = player.pos.z;
    const playerSpeed = Math.abs(player.car ? player.car.speed : player.speed);
    let contact = false;

    for (const car of this.cars) {
      const gp = car.group.position;
      const dx = px - gp.x;
      const dz = pz - gp.z;
      const dist = Math.hypot(dx, dz) || 1;
      // steer toward the player, with crude building avoidance
      const want = angleTo(gp.x, gp.z, px, pz);
      car.heading = turnToward(car.heading, want, 2.6, dt);
      const nx = gp.x + Math.sin(car.heading) * 1;
      const nz = gp.z + Math.cos(car.heading) * 1;
      if (this.city.collide(nx, nz, 1.4)) {
        car.heading = turnToward(car.heading, car.heading + 0.9, 2.6, dt);
      }
      // slow for a traffic car directly ahead
      let targetSpeed = 36;
      for (const o of this.vehicles.cars) {
        if (o.driver) continue;
        const ox = o.group.position.x - gp.x;
        const oz = o.group.position.z - gp.z;
        const od = Math.hypot(ox, oz);
        if (od < 9 && od > 0.01) {
          const dot = (ox * Math.sin(car.heading) + oz * Math.cos(car.heading)) / od;
          if (dot > 0.85) targetSpeed = Math.min(targetSpeed, Math.max(0, o.speed));
        }
      }
      if (dist < 10) targetSpeed = Math.min(targetSpeed, 20);
      car.speed += (targetSpeed - car.speed) * Math.min(1, 1.6 * dt);
      gp.x += Math.sin(car.heading) * car.speed * dt;
      gp.z += Math.cos(car.heading) * car.speed * dt;
      gp.x = Math.max(-WORLD.bound, Math.min(WORLD.bound, gp.x));
      gp.z = Math.max(-WORLD.bound, Math.min(WORLD.bound, gp.z));
      car.group.rotation.y = car.heading;
      // flashing light bar: both lights stay visible, their brightness
      // alternates, so the bar always reads as police lights in a still frame
      const phase = Math.floor(this.time * 6) % 2 === 0;
      if (car._lightR) car._lightR.material.color.setHex(phase ? 0xff2a22 : 0x5a0f0c);
      if (car._lightB) car._lightB.material.color.setHex(phase ? 0x0e2a66 : 0x2a6bff);
      // ramming the player
      if (dist < 4.2) {
        contact = true;
        if (player.car) {
          player.car.speed *= Math.max(0, 1 - 2.2 * dt);
          player.car.heading += 0.35 * dt;
        }
      }
    }

    // ---- foot officers ----
    for (const off of this.officers) {
      const gp = off.group.position;
      const dx = px - gp.x;
      const dz = pz - gp.z;
      const dist = Math.hypot(dx, dz) || 1;
      const want = angleTo(gp.x, gp.z, px, pz);
      off.heading = turnToward(off.heading, want, 5, dt);
      off.group.rotation.y = off.heading;
      if (dist > 3) {
        const step = Math.min(dist - 2.5, 6.5 * dt);
        gp.x += (dx / dist) * step;
        gp.z += (dz / dist) * step;
      }
      off.shootTimer -= dt;
      if (dist < 28 && off.shootTimer <= 0) {
        off.shootTimer = 0.9;
        this.audio?.gunshot();
        if (this.rng.chance(0.35)) player.takeDamage(6);
      }
      if (dist < 2.4 && player.onFoot && playerSpeed < 3) contact = true;
    }

    // ---- bust: a unit stays on top of a slow player ----
    if (contact && player.onFoot && playerSpeed < 3) {
      this.bustTimer += dt;
      if (this.bustTimer >= BUST_HOLD) this.busted = true;
    } else {
      this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
    }
  }
}
