// Neon Shores — Rico Vega, the player.
// On foot: WASD/arrows + Shift to run, F punch, click shoot, R reload, E steal/exit.
// In a car: the same keys drive (see vehicles.js Car.drive).
//
// INTERFACE (what main.js / the next session wires against):
//   new Player(scene, city)
//   player.pos            -> THREE.Vector3 (group.position)
//   player.heading        -> rotation.y; forward = (sin h, 0, cos h)
//   player.health, player.money, player.ammo, player.magSize
//   player.wanted         -> float stars; police.js reads & decays it
//   player.onFoot, player.car, player.dead, player.speedKmh
//   player.update(dt, input, world)
//     input: { f, b, l, r, run, camHeading }  (continuous movement keys)
//     world: { city, vehicles, peds }
//   player.tryEnterCar(vehicles) -> bool (E key)
//   player.exitCar()             -> bool (E key while driving)
//   player.punch(world)          (F key)
//   player.shoot(world)          (mouse click)
//   player.startReload()         (R key)
//   player.takeDamage(n)
//   player.addWanted(n)
//   player.getSaveState() / player.applySaveState(s)

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { FX } from './effects.js';

const P = CONFIG.player;

export class Player {
  constructor(scene, city) {
    this.city = city;
    this.health = P.health;
    this.money = 0;
    this.ammo = P.magSize;
    this.magSize = P.magSize;
    this.wanted = 0;
    this.heading = 0;
    this.speed = 0;
    this.onFoot = true;
    this.car = null;
    this.dead = false;
    this.reloadTimer = 0;
    this.shootTimer = 0;
    this.punchTimer = 0;
    this.smokeTimer = 0;
    this.vx = 0;
    this.vz = 0;

    const sp = city.spawnPoints.player;
    this.group = new THREE.Group();
    this.group.name = 'rico';

    // Rico's jacket is a bright red so he reads against the dark street;
    // a small emissive keeps it red on the shadowed side too
    const jacket = new THREE.MeshLambertMaterial({ color: 0xa83232, emissive: 0x5a1616 });
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x222226 });
    this.body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.95, 0.36), jacket);
    this.body.position.y = 0.95;
    this.body.castShadow = true;
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skin);
    this.head.position.y = 1.62;
    this.head.castShadow = true;
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.18), jacket);
    this.arm.position.set(0.42, 1.0, 0.1);
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.42), dark);
    this.gun.position.set(0.42, 0.95, 0.35);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.75, 0.22), dark);
    legL.position.set(-0.16, 0.38, 0);
    const legR = legL.clone();
    legR.position.x = 0.16;
    this.group.add(this.body, this.head, this.arm, this.gun, legL, legR);
    this.group.position.set(sp.x, 0, sp.z);
    this.group.rotation.y = sp.heading;
    this.heading = sp.heading;
    scene.add(this.group);

    // muzzle flash (shown for one frame on shoot)
    this.flash = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.16, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    );
    this.flash.visible = false;
    this.flash.position.set(0.42, 0.95, 0.62);
    this.group.add(this.flash);
    this.flashTimer = 0;
  }

  get pos() {
    return this.group.position;
  }

  get speedKmh() {
    return Math.abs(this.car ? this.car.speed : this.speed) * 3.6;
  }

  update(dt, input, world) {
    if (this.dead) return;
    this.shootTimer = Math.max(0, this.shootTimer - dt);
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    this.flashTimer = Math.max(0, this.flashTimer - dt);
    this.flash.visible = this.flashTimer > 0;
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.ammo = this.magSize;
    }
    // punch swing animation
    this.arm.rotation.x = this.punchTimer > 0.25 ? -1.4 : 0;

    if (!this.onFoot && this.car) {
      this.car.drive(dt, input, this.city);
      this.group.position.copy(this.car.group.position);
      this.group.position.y = 0.4;
      this.group.visible = false;
      this.heading = this.car.heading;
      this.speed = this.car.speed;
      // tyre smoke: a hard launch, or steering hard at speed
      this.smokeTimer -= dt;
      const drifting = (input.l || input.r) && Math.abs(this.speed) > 14;
      const burnout = input.f && this.speed >= 0 && this.speed < 8;
      if ((drifting || burnout) && this.smokeTimer <= 0) {
        this.smokeTimer = 0.09;
        const fx = Math.sin(this.heading);
        const fz = Math.cos(this.heading);
        const rx = Math.cos(this.heading);
        const rz = -Math.sin(this.heading);
        const px = this.car.group.position.x;
        const pz = this.car.group.position.z;
        for (const s of [-0.95, 0.95]) {
          FX.puff(px - fx * 1.5 + rx * s, 0.3, pz - fz * 1.5 + rz * s);
        }
      }
      return;
    }
    this.group.visible = true;

    // --- on-foot movement, relative to camera heading ---
    const h = input.camHeading || 0;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = Math.cos(h);
    const rz = -Math.sin(h);
    let mx = fx * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + rx * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
    let mz = fz * ((input.f ? 1 : 0) - (input.b ? 1 : 0)) + rz * ((input.r ? 1 : 0) - (input.l ? 1 : 0));
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const target = (input.run ? P.runSpeed : P.walkSpeed);
    this.vx += (mx * target - this.vx) * Math.min(1, P.accel * dt / Math.max(target, 1));
    this.vz += (mz * target - this.vz) * Math.min(1, P.accel * dt / Math.max(target, 1));
    this.speed = Math.hypot(this.vx, this.vz);

    const nx = this.pos.x + this.vx * dt;
    const nz = this.pos.z + this.vz * dt;
    const B = CONFIG.world.bound;
    if (!this.city.collide(nx, this.pos.z, P.radius)) {
      this.pos.x = Math.max(-B, Math.min(B, nx));
    } else {
      this.vx = 0;
    }
    if (!this.city.collide(this.pos.x, nz, P.radius)) {
      this.pos.z = Math.max(-B, Math.min(B, nz));
    } else {
      this.vz = 0;
    }
    // face movement direction
    if (this.speed > 0.5) {
      const want = Math.atan2(this.vx, this.vz);
      let d = want - this.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.heading += d * Math.min(1, 12 * dt);
      this.group.rotation.y = this.heading;
    }
    // walk bob
    const bob = this.speed > 0.5 ? Math.sin(performance.now() * 0.02) * 0.04 : 0;
    this.body.position.y = 0.95 + bob;
  }

  tryEnterCar(vehicles) {
    if (!this.onFoot || this.dead) return false;
    const car = vehicles.nearestCar(this.pos, 4.5);
    if (!car) return false;
    this.car = car;
    this.onFoot = false;
    car.driver = 'player';
    car.parked = false;
    car.isTraffic = false;
    this.addWanted(CONFIG.wanted.stealStars);
    return true;
  }

  exitCar() {
    if (this.onFoot || !this.car) return false;
    const car = this.car;
    car.driver = null;
    car.speed = 0;
    car.parked = true;
    // step out to the car's left side
    const sx = Math.cos(car.heading);
    const sz = -Math.sin(car.heading);
    this.pos.set(car.group.position.x + sx * 2.2, 0, car.group.position.z + sz * 2.2);
    if (this.city.collide(this.pos.x, this.pos.z, P.radius)) {
      this.pos.set(car.group.position.x - sx * 2.2, 0, car.group.position.z - sz * 2.2);
    }
    this.car = null;
    this.onFoot = true;
    this.group.visible = true;
    this.group.position.y = 0;
    return true;
  }

  punch(world) {
    if (this.dead || !this.onFoot || this.punchTimer > 0) return;
    this.punchTimer = 0.45;
    const ped = world.peds.nearestPed(this.pos, P.punchRange, this.heading);
    if (ped) {
      const killed = ped.hit(P.punchDamage);
      this.addWanted(killed ? CONFIG.wanted.killStars : CONFIG.wanted.punchStars);
    }
    world.peds.scare(this.pos.x, this.pos.z, 12);
  }

  shoot(world) {
    if (this.dead || this.shootTimer > 0 || this.reloadTimer > 0) return;
    if (this.ammo <= 0) {
      this.startReload();
      return;
    }
    this.ammo -= 1;
    this.shootTimer = P.shootCooldown;
    this.flashTimer = 0.06;
    // muzzle sparks + a small kick
    FX.muzzle(this.pos.x, 1.0, this.pos.z, this.heading);
    FX.shake(0.05);
    const ped = world.peds.nearestPed(this.pos, P.shootRange, this.heading, 0.92);
    if (ped) {
      const killed = ped.hit(P.shootDamage);
      this.addWanted(killed ? CONFIG.wanted.killStars : CONFIG.wanted.shootStars);
    } else {
      this.addWanted(0.4); // shots are heard
    }
    world.peds.scare(this.pos.x, this.pos.z, 30);
    if (this.ammo <= 0) this.startReload();
  }

  startReload() {
    if (this.reloadTimer <= 0 && this.ammo < this.magSize) this.reloadTimer = P.reloadTime;
  }

  takeDamage(n) {
    if (this.dead) return;
    this.health -= n;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
    }
  }

  addWanted(n) {
    this.wanted = Math.min(CONFIG.wanted.maxStars, this.wanted + n);
  }

  getSaveState() {
    return { money: this.money, health: this.health, x: this.pos.x, z: this.pos.z };
  }

  applySaveState(s) {
    if (!s) return;
    this.money = s.money || 0;
    this.health = s.health || P.health;
    if (typeof s.x === 'number') this.pos.set(s.x, 0, s.z || 0);
  }
}
