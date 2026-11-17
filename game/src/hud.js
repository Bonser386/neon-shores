// Neon Shores — HUD and minimap.
// Reads the game state each frame and writes it into the DOM session 1 built
// (money, wanted stars, clock, objective, health, ammo, speed, minimap) plus
// a bottom-centre objective bar and toast messages.
//
// INTERFACE (what main.js wires against):
//   new HUD(city)
//   hud.update(dt, state)
//     state: { player, missions, police, clockMin (minutes since midnight) }
//   hud.toast(text)   // bottom-centre message, fades after ~2.5 s

import { CONFIG } from './config.js';

function $(id) {
  return document.getElementById(id);
}

export class HUD {
  constructor(city) {
    this.city = city;
    this.money = $('hud-money');
    this.wantedEl = $('hud-wanted');
    this.stars = this.wantedEl ? [...this.wantedEl.querySelectorAll('.star')] : [];
    this.clock = $('hud-clock');
    this.objective = $('hud-objective');
    this.objectiveDist = $('hud-objective-dist');
    this.objectiveBar = $('hud-objective-bar');
    this.healthFill = $('hud-health-fill');
    this.healthText = $('hud-health-text');
    this.ammo = $('hud-ammo');
    this.speed = $('hud-speed');
    this.crosshair = $('crosshair');
    this.toastEl = $('toast');
    this.map = $('minimap');
    this.mapCtx = this.map ? this.map.getContext('2d') : null;
    this.toastTimer = null;
  }

  toast(text) {
    if (!this.toastEl) return;
    this.toastEl.textContent = text;
    this.toastEl.style.opacity = '1';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.style.opacity = '0';
    }, 2600);
  }

  update(_dt, state) {
    const { player, missions, police, clockMin } = state;

    // money
    if (this.money) {
      this.money.textContent = '$' + Math.floor(player.money).toLocaleString('en-US');
    }

    // wanted stars: any heat at all lights at least one star
    const lit = player.wanted <= 0 ? 0 : Math.min(5, Math.ceil(player.wanted));
    this.stars.forEach((s, i) => s.classList.toggle('on', i < lit));

    // clock
    if (this.clock) {
      const mins = Math.floor(clockMin || 0) % (24 * 60);
      const hh = String(Math.floor(mins / 60)).padStart(2, '0');
      const mm = String(mins % 60).padStart(2, '0');
      this.clock.textContent = `${hh}:${mm}`;
    }

    // objective
    const obj = missions.getObjective();
    if (this.objective) this.objective.textContent = obj.name;
    if (this.objectiveDist) {
      this.objectiveDist.textContent = obj.dist != null
        ? `${obj.text} · ${Math.round(obj.dist)}m`
        : obj.text;
    }
    if (this.objectiveBar) {
      this.objectiveBar.textContent = obj.text + (obj.dist != null ? ` — ${Math.round(obj.dist)}m` : '');
    }

    // health
    const hp = Math.max(0, Math.round(player.health));
    if (this.healthFill) {
      this.healthFill.style.width = hp + '%';
      this.healthFill.style.background = hp > 50 ? '#3fce62' : hp > 25 ? '#f5b942' : '#ff3b30';
    }
    if (this.healthText) this.healthText.textContent = `HEALTH ${hp}`;

    // ammo
    if (this.ammo) {
      this.ammo.textContent = player.reloadTimer > 0
        ? 'Reloading…'
        : `Pistol ${player.ammo} / ∞`;
    }

    // speed: only while driving
    if (this.speed) {
      this.speed.textContent = player.onFoot ? '' : `${Math.round(player.speedKmh)} km/h`;
    }

    // crosshair: on foot only
    if (this.crosshair) {
      this.crosshair.style.display = player.onFoot ? 'block' : 'none';
    }

    this.drawMinimap(player, missions, police);
  }

  drawMinimap(player, missions, police) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const S = 180;
    const B = CONFIG.world.bound;
    const scale = S / (B * 2);
    const px = (x) => (x + B) * scale;
    const py = (z) => (z + B) * scale; // north (-z) is up

    ctx.fillStyle = '#0c1420';
    ctx.fillRect(0, 0, S, S);
    // ocean on the east edge
    ctx.fillStyle = '#14506e';
    ctx.fillRect(px(300), 0, S - px(300), S);
    // roads
    ctx.strokeStyle = '#2a3648';
    ctx.lineWidth = 2;
    for (let i = 0; i <= CONFIG.world.gridN; i++) {
      const c = this.city.roadCoord(i);
      ctx.beginPath(); ctx.moveTo(px(c), 0); ctx.lineTo(px(c), S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, py(c)); ctx.lineTo(S, py(c)); ctx.stroke();
    }
    // cash drops (mission 4)
    const obj = missions.getObjective();
    if (missions.index === 3) {
      ctx.fillStyle = '#7ee787';
      for (const d of this.city.spawnPoints.cashDrops) {
        if (missions.collected.has(this.city.spawnPoints.cashDrops.indexOf(d))) continue;
        ctx.beginPath(); ctx.arc(px(d.x), py(d.z), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // mission target: gold diamond
    if (obj.target) {
      ctx.fillStyle = '#ffd24a';
      const tx = px(obj.target.x);
      const ty = py(obj.target.z);
      ctx.beginPath();
      ctx.moveTo(tx, ty - 6); ctx.lineTo(tx + 5, ty); ctx.lineTo(tx, ty + 6); ctx.lineTo(tx - 5, ty);
      ctx.closePath(); ctx.fill();
    }
    // traffic: small white dots
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const car of (police.vehicles ? police.vehicles.cars : [])) {
      if (car.driver) continue;
      ctx.fillRect(px(car.group.position.x) - 1, py(car.group.position.z) - 1, 2, 2);
    }
    // police: red dots
    ctx.fillStyle = '#ff3b30';
    for (const car of police.cars) {
      ctx.beginPath();
      ctx.arc(px(car.group.position.x), py(car.group.position.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // player: white arrow, rotated by heading
    const x = px(player.pos.x);
    const y = py(player.pos.z);
    ctx.save();
    ctx.translate(x, y);
    // heading h: forward = (sin h, cos h) in (x, z); on the map +x is right,
    // +z is down, so the canvas angle is h measured clockwise from down.
    ctx.rotate(Math.PI - player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}
