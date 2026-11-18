// Neon Shores — the seven-job story.
// Missions run in order; each has a payout and a visible beacon marking the
// current target. The HUD reads getObjective() for the name, the instruction
// line and the distance to the target.
//
// INTERFACE (what main.js / hud.js / shots.js wire against):
//   new Missions(scene, city, player, vehicles, police, audio?)
//   missions.index        -> 0..5 (5 = all jobs done)
//   missions.allDone      -> bool
//   missions.update(dt)
//   missions.getObjective() -> { name, text, dist (m | null), target {x,z} | null }
//   missions.getTarget()    -> { x, z } | null
//   missions.setMission(i)  -> (re)start mission i (used by shots.js)
//   missions.onComplete     -> fn(mission) — main.js shows the overlay
//   missions.onMissionStart -> fn(mission) — main.js toasts the job
//   missions.getSaveState() / missions.applySaveState(s)

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { makeGlowSprite } from './effects.js';

const DATA = CONFIG.missions;

export class Missions {
  constructor(scene, city, player, vehicles, police, audio = null) {
    this.scene = scene;
    this.city = city;
    this.player = player;
    this.vehicles = vehicles;
    this.police = police;
    this.audio = audio;
    this.index = 0;
    this.stage = 0;
    this.allDone = false;
    this.collected = new Set();
    this.onComplete = null;
    this.onMissionStart = null;

    // beacon: a glowing column + a floating diamond over the active target
    this.beacon = new THREE.Group();
    this.beacon.name = 'mission-beacon';
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd24a, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    column.position.y = 30;
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.4),
      new THREE.MeshBasicMaterial({ color: 0xffd24a }),
    );
    diamond.position.y = 8;
    this.beaconDiamond = diamond;
    this.beacon.add(column, diamond);
    this.beacon.visible = false;
    scene.add(this.beacon);

    // cash-drop markers (mission 4): small glowing crates at the drop points
    this.dropMeshes = [];
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x7ee787 });
    for (const p of city.spawnPoints.cashDrops) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), dropMat);
      m.position.set(p.x, 0.6, p.z);
      m.visible = false;
      scene.add(m);
      this.dropMeshes.push(m);
    }

    // courier package (mission 6, stage 0): a glowing orange crate at the
    // downtown pickup; the safehouse (mission 5, stage 1) gets a cyan marker
    this.packageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.0, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xff7a2a }),
    );
    this.packageMesh.position.set(city.spawnPoints.courierPickup.x, 0.7, city.spawnPoints.courierPickup.z);
    this.packageMesh.visible = false;
    scene.add(this.packageMesh);
    const packageGlow = makeGlowSprite(0xff7a2a, 7, 0.45);
    packageGlow.position.set(city.spawnPoints.courierPickup.x, 1.2, city.spawnPoints.courierPickup.z);
    this.packageGlow = packageGlow;
    scene.add(packageGlow);
    this.safehouseMesh = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 2.0, 2.0),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
    );
    this.safehouseMesh.position.set(city.spawnPoints.safehouse.x, 1.2, city.spawnPoints.safehouse.z);
    this.safehouseMesh.visible = false;
    scene.add(this.safehouseMesh);
    const safehouseGlow = makeGlowSprite(0x22d3ee, 9, 0.45);
    safehouseGlow.position.set(city.spawnPoints.safehouse.x, 2.0, city.spawnPoints.safehouse.z);
    this.safehouseGlow = safehouseGlow;
    scene.add(safehouseGlow);
  }

  current() {
    return DATA[this.index] || null;
  }

  setMission(i) {
    this.index = Math.max(0, Math.min(DATA.length, i));
    this.stage = 0;
    this.allDone = this.index >= DATA.length;
    this.collected.clear();
    if (this.index === 6) {
      // the final job starts under pursuit
      this.player.wanted = Math.max(this.player.wanted, 2);
      this.stage = 1;
    }
    const cur = this.current();
    if (cur && this.onMissionStart) this.onMissionStart(cur);
  }

  complete() {
    const m = this.current();
    if (!m) return;
    this.player.money += m.reward;
    this.audio?.missionComplete();
    this.index += 1;
    this.stage = 0;
    this.allDone = this.index >= DATA.length;
    if (this.onComplete) this.onComplete(m);
    if (!this.allDone) {
      const next = this.current();
      if (next && this.onMissionStart) this.onMissionStart(next);
      if (this.index === 6) {
        this.player.wanted = Math.max(this.player.wanted, 2);
        this.stage = 1;
      }
    }
  }

  distTo(p) {
    if (!p) return null;
    return Math.hypot(this.player.pos.x - p.x, this.player.pos.z - p.z);
  }

  // the point the beacon + minimap marker sit on, or null
  getTarget() {
    const m = this.current();
    if (!m) return null;
    const sp = this.city.spawnPoints;
    switch (m.id) {
      case 'first-wheels':
        return this.stage === 1 ? sp.boardwalk : null;
      case 'gold-coupe':
        return this.stage === 1 ? sp.chopShop : null;
      case 'lose-heat':
        return null;
      case 'cash-drops': {
        let best = null;
        let bestD = Infinity;
        sp.cashDrops.forEach((p, i) => {
          if (this.collected.has(i)) return;
          const d = this.distTo(p);
          if (d < bestD) { bestD = d; best = p; }
        });
        return best;
      }
      case 'getaway':
        return this.stage === 1 ? sp.safehouse : null;
      case 'courier':
        return this.stage === 0 ? sp.courierPickup : sp.courierDrop;
      case 'dock-run':
        return sp.docks;
      default:
        return null;
    }
  }

  getObjective() {
    const m = this.current();
    if (!m) {
      return { name: 'All jobs done', text: 'Solmar is yours, Rico.', dist: null, target: null };
    }
    const target = this.getTarget();
    const dist = this.distTo(target);
    switch (m.id) {
      case 'first-wheels':
        return this.stage === 0
          ? { name: m.name, text: 'Steal a car', dist: null, target: null }
          : { name: m.name, text: 'Drive to the pickup on the boardwalk', dist, target };
      case 'gold-coupe':
        return this.stage === 0
          ? { name: m.name, text: 'Steal the gold coupe', dist: null, target: null }
          : { name: m.name, text: 'Deliver it to the chop shop', dist, target };
      case 'lose-heat':
        return this.stage === 0
          ? { name: m.name, text: 'Raise your wanted level to 3 stars', dist: null, target: null }
          : { name: m.name, text: 'Lose the tail — get your wanted level under 1 star', dist: null, target: null };
      case 'cash-drops':
        return {
          name: m.name,
          text: `Collect the cash drops (${this.collected.size}/5)`,
          dist, target,
        };
      case 'getaway':
        return this.stage === 0
          ? { name: m.name, text: 'Raise your wanted level to 4 stars', dist: null, target: null }
          : { name: m.name, text: 'Reach the safehouse on the beach — lose the tail', dist, target };
      case 'courier':
        return this.stage === 0
          ? { name: m.name, text: 'Pick up the package downtown', dist, target }
          : { name: m.name, text: 'Deliver the package to the port warehouse — in a car', dist, target };
      case 'dock-run':
        return { name: m.name, text: 'Final delivery at the docks — under pursuit', dist, target };
      default:
        return { name: m.name, text: m.blurb, dist, target };
    }
  }

  update(dt) {
    this._time = (this._time || 0) + dt;
    if (this.allDone) {
      this.beacon.visible = false;
      this._setMarkers(false, false, false);
      return;
    }
    const m = this.current();
    if (!m) return;
    const p = this.player;
    const sp = this.city.spawnPoints;

    switch (m.id) {
      case 'first-wheels': {
        if (this.stage === 0 && !p.onFoot) this.stage = 1;
        if (this.stage === 1 && this.distTo(sp.boardwalk) < 9) this.complete();
        break;
      }
      case 'gold-coupe': {
        if (this.stage === 0 && p.car === this.vehicles.goldCoupe) this.stage = 1;
        if (this.stage === 1 && this.distTo(sp.chopShop) < 10) this.complete();
        break;
      }
      case 'lose-heat': {
        if (this.stage === 0 && p.wanted >= 3) this.stage = 1;
        if (this.stage === 1 && p.wanted < 1) this.complete();
        break;
      }
      case 'cash-drops': {
        sp.cashDrops.forEach((drop, i) => {
          if (this.collected.has(i)) return;
          if (this.distTo(drop) < 4) {
            this.collected.add(i);
            this.dropMeshes[i].visible = false;
            this.audio?.pickup();
          }
        });
        if (this.collected.size >= sp.cashDrops.length) this.complete();
        break;
      }
      case 'getaway': {
        // raise the heat to 4 stars, then run for the beach safehouse
        if (this.stage === 0 && p.wanted >= 4) {
          this.stage = 1;
          p.wanted = Math.max(p.wanted, 3); // keep the chase hot
        }
        if (this.stage === 1 && this.distTo(sp.safehouse) < 10) this.complete();
        break;
      }
      case 'courier': {
        if (this.stage === 0 && this.distTo(sp.courierPickup) < 6) {
          this.stage = 1;
          this.audio?.pickup();
        }
        // the delivery only counts in a car — no dropping it off on foot
        if (this.stage === 1 && !p.onFoot && this.distTo(sp.courierDrop) < 10) this.complete();
        break;
      }
      case 'dock-run': {
        if (this.distTo(sp.docks) < 10) this.complete();
        break;
      }
      default:
        break;
    }

    // marker visibility is owned here (not by setMission/complete), so a
    // loaded save shows the right markers on the first frame
    this._setMarkers(
      this.index === 3,
      this.index === 5 && this.stage === 0,
      this.index === 4 && this.stage === 1,
    );

    // beacon follows the active target, diamond bobs
    const target = this.getTarget();
    if (target) {
      this.beacon.visible = true;
      this.beacon.position.set(target.x, 0, target.z);
      this.beaconDiamond.position.y = 8 + Math.sin(this.time * 2.4) * 0.8;
      this.beaconDiamond.rotation.y += dt * 1.5;
    } else {
      this.beacon.visible = false;
    }
  }

  // drops / package / safehouse markers: one place decides all three
  _setMarkers(showDrops, showPackage, showSafehouse) {
    this.dropMeshes.forEach((mesh, i) => {
      mesh.visible = showDrops && !this.collected.has(i);
    });
    this.packageMesh.visible = showPackage;
    this.packageGlow.visible = showPackage;
    this.safehouseMesh.visible = showSafehouse;
    this.safehouseGlow.visible = showSafehouse;
  }

  get time() {
    return this._time || 0;
  }

  set time(v) {
    this._time = v;
  }

  getSaveState() {
    return { index: this.index, collected: [...this.collected] };
  }

  applySaveState(s) {
    if (!s) return;
    if (typeof s.index === 'number') {
      this.index = Math.max(0, Math.min(DATA.length, s.index));
      this.allDone = this.index >= DATA.length;
    }
    if (Array.isArray(s.collected)) this.collected = new Set(s.collected);
    // marker visibility is set by update() on the next frame
  }
}
