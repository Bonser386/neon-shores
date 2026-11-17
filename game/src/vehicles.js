// Neon Shores — cars: arcade physics, traffic AI on the road graph, parked cars.
//
// INTERFACE (what main.js / the next session wires against):
//   new VehicleManager(scene, city, rng)
//   manager.cars       -> Car[] (24 total: 16 traffic + 8 parked)
//   manager.goldCoupe  -> Car (the gold coupe for mission 2, parked)
//   manager.update(dt, world)   // world: { city, player } — drives traffic AI only;
//                               // the player-driven car is driven by Player.update
//   manager.nearestCar(pos, maxDist) -> Car | null
//   Car: group, heading, speed, parked, isTraffic, driver ('player' | null)
//   Car.drive(dt, input, city)  // arcade physics for the player-driven car
//   Car.speedKmh
// Car forward is +z when heading = 0; heading = rotation.y.

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG, roadCoord } from './config.js';

const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0x2fae5f, 0xe8b73a, 0xe8e8e8, 0x222226, 0x7a4a9e, 0xd46a2a];
const GOLD = 0xd4af37;

export class Car {
  constructor(scene, opts) {
    this.heading = opts.heading || 0;
    this.speed = 0;
    this.parked = !!opts.parked;
    this.isTraffic = !!opts.traffic;
    this.driver = null;
    this.node = opts.node ?? -1;      // current road-graph node (traffic)
    this.next = opts.next ?? -1;      // target node (traffic)
    this.from = -1;
    this.cruise = CONFIG.car.trafficSpeed + (opts.jitter || 0);

    const color = opts.color ?? 0x888888;
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x141c26 });
    const tyreMat = new THREE.MeshLambertMaterial({ color: 0x111114 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 4.4), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.2), glassMat);
    cabin.position.set(0, 1.15, -0.2);
    cabin.castShadow = true;
    this.group.add(body, cabin);
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.6, 0.6), tyreMat);
      wheel.position.set(wx, 0.3, wz);
      this.group.add(wheel);
    }
    const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });
    for (const hx of [-0.6, 0.6]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), headMat);
      hl.position.set(hx, 0.55, 2.21);
      this.group.add(hl);
    }
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a22 });
    for (const hx of [-0.6, 0.6]) {
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), tailMat);
      tl.position.set(hx, 0.55, -2.21);
      this.group.add(tl);
    }
    this.group.position.set(opts.x || 0, 0, opts.z || 0);
    this.group.rotation.y = this.heading;
    scene.add(this.group);
  }

  get speedKmh() {
    return Math.abs(this.speed) * 3.6;
  }

  // --- player driving: arcade physics ---
  drive(dt, input, city) {
    const C = CONFIG.car;
    const fwd = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    if (fwd > 0) this.speed += C.accel * dt;
    else if (fwd < 0) {
      this.speed += this.speed > 0.5 ? -C.brake * dt : -C.reverseAccel * dt;
    } else {
      // rolling drag
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 8 * dt);
    }
    this.speed = Math.max(-C.maxReverse, Math.min(C.maxSpeed, this.speed));
    const steer = (input.l ? 1 : 0) - (input.r ? 1 : 0);
    const spdF = Math.max(-1, Math.min(1, this.speed / 10));
    this.heading += steer * C.steer * spdF * dt;
    this.group.rotation.y = this.heading;
    const nx = this.group.position.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.group.position.z + Math.cos(this.heading) * this.speed * dt;
    const B = CONFIG.world.bound;
    if (!city.collide(nx, nz, 1.4)) {
      this.group.position.x = Math.max(-B, Math.min(B, nx));
      this.group.position.z = Math.max(-B, Math.min(B, nz));
    } else {
      this.speed *= -0.25; // bounce off the building
    }
  }

  // --- traffic AI: follow the road graph, right-hand lane ---
  aiUpdate(dt, city, others) {
    if (this.parked || this.driver) return;
    const g = city.roadGraph;
    if (this.next < 0) return;
    const target = g.nodes[this.next];
    const dx = target.x - this.group.position.x;
    const dz = target.z - this.group.position.z;
    const dist = Math.hypot(dx, dz);
    // right-hand lane offset
    const dirx = dx / (dist || 1);
    const dirz = dz / (dist || 1);
    const rx = -dirz;
    const rz = dirx;
    const tx = target.x + rx * CONFIG.car.laneOffset;
    const tz = target.z + rz * CONFIG.car.laneOffset;
    const tdx = tx - this.group.position.x;
    const tdz = tz - this.group.position.z;
    const tdist = Math.hypot(tdx, tdz);
    const wantHeading = Math.atan2(tdx, tdz);
    let dh = wantHeading - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, dh));
    this.group.rotation.y = this.heading;
    // slow down for the car ahead
    let targetSpeed = this.cruise;
    for (const o of others) {
      if (o === this || o.parked || o.driver) continue;
      const ox = o.group.position.x - this.group.position.x;
      const oz = o.group.position.z - this.group.position.z;
      const od = Math.hypot(ox, oz);
      if (od < 8 && od > 0.01) {
        const dot = (ox * Math.sin(this.heading) + oz * Math.cos(this.heading)) / od;
        if (dot > 0.8) targetSpeed = Math.min(targetSpeed, o.speed);
      }
    }
    if (tdist < 4) targetSpeed = Math.max(0, targetSpeed - 3);
    this.speed += (targetSpeed - this.speed) * Math.min(1, 2 * dt);
    this.group.position.x += Math.sin(this.heading) * this.speed * dt;
    this.group.position.z += Math.cos(this.heading) * this.speed * dt;
    if (dist < 4.5) {
      // arrived at the node: pick the next one (not back where we came from)
      this.from = this.node;
      this.node = this.next;
      const options = g.neighbors(this.node).filter((n) => n !== this.from);
      this.next = options.length
        ? options[Math.floor(Math.random() * options.length)]
        : g.neighbors(this.node)[0];
    }
  }
}

export class VehicleManager {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.goldCoupe = null;
    this.spawn();
  }

  spawn() {
    const g = this.city.roadGraph;
    const rng = this.rng;
    // --- moving traffic: 16 cars on the graph ---
    for (let i = 0; i < CONFIG.traffic.moving; i++) {
      const node = rng.randInt(0, g.nodes.length - 1);
      const nbs = g.neighbors(node);
      const next = rng.pick(nbs);
      const n = g.nodes[node];
      const car = new Car(this.scene, {
        x: n.x, z: n.z, heading: 0,
        color: rng.pick(CAR_COLORS), traffic: true,
        node, next, jitter: rng.rand(-CONFIG.car.trafficSpeedJitter, CONFIG.car.trafficSpeedJitter),
      });
      this.cars.push(car);
    }
    // --- parked cars: 8 along road edges ---
    for (let i = 0; i < CONFIG.traffic.parked; i++) {
      const vertical = rng.chance(0.5);
      const road = roadCoord(rng.randInt(0, 8));
      const along = rng.rand(-240, 240);
      const side = rng.chance(0.5) ? 1 : -1;
      const off = (CONFIG.world.roadWidth / 2 + 1.2) * side;
      const x = vertical ? road + off : along;
      const z = vertical ? along : road + off;
      const heading = vertical ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
      const car = new Car(this.scene, { x, z, heading, color: rng.pick(CAR_COLORS), parked: true });
      this.cars.push(car);
    }
    // --- the gold coupe (mission 2): parked at its spawn point ---
    const gp = this.city.spawnPoints.goldCoupe;
    this.goldCoupe = new Car(this.scene, {
      x: gp.x, z: gp.z, heading: Math.PI / 2, color: GOLD, parked: true,
    });
    this.cars.push(this.goldCoupe);
  }

  update(dt) {
    for (const car of this.cars) car.aiUpdate(dt, this.city, this.cars);
  }

  nearestCar(pos, maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const car of this.cars) {
      const d = Math.hypot(car.group.position.x - pos.x, car.group.position.z - pos.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }
}
