// Neon Shores — boot, game loop, input, camera, screens, save/load.
// Wires the modules session 1 and this session wrote into a playable game.
// ?shot=<name>&seed=N runs one staged screenshot scene instead of the title
// screen and sets window.__shotReady after the first rendered frame.
//
// Screens: start / playing / paused / mission (job done) / busted / wasted.
// Save: money, health, mission progress and position in localStorage.

import * as THREE from '../vendor/three.module.min.js';
import { CONFIG } from './config.js';
import { makeRng } from './random.js';
import { buildCity } from './city.js';
import { Player } from './player.js';
import { VehicleManager } from './vehicles.js';
import { PedestrianManager } from './pedestrians.js';
import { Police } from './police.js';
import { Missions } from './missions.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const SEED = parseInt(params.get('seed') || '1', 10) || 1;
const SHOT_MODE = !!SHOT;

// ---- renderer / scene ----------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.sky);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 80, 700);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 1200);

const hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a2f28, 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight(CONFIG.colors.sun, 1.6);
sun.position.set(180, 240, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -320;
sun.shadow.camera.right = 320;
sun.shadow.camera.top = 320;
sun.shadow.camera.bottom = -320;
sun.shadow.camera.far = 700;
scene.add(sun);

// ---- world ----------------------------------------------------------------
const rng = makeRng(SEED);
const city = buildCity(scene, rng);
const vehicles = new VehicleManager(scene, city, rng);
const peds = new PedestrianManager(scene, city, rng);
const player = new Player(scene, city);
const audio = new AudioSys();
const police = new Police(scene, city, rng, player, vehicles, audio);
const missions = new Missions(scene, city, player, vehicles, police, audio);
const hud = new HUD(city);

// ---- state -----------------------------------------------------------------
let mode = 'start'; // start | playing | paused | mission | busted | wasted
let camYaw = player.heading;
let clockMin = CONFIG.clock.startHour * 60 + CONFIG.clock.startMinute;
let elapsed = 0;
let lastDamageAt = -999;
let prevHealth = player.health;
let shotReady = false;
let muted = false;

const G = { city, player, vehicles, peds, police, missions, hud, audio, scene, rng };

// ---- save / load ------------------------------------------------------------
function save() {
  try {
    localStorage.setItem(CONFIG.saveKey, JSON.stringify({
      player: player.getSaveState(),
      missions: missions.getSaveState(),
      clockMin,
    }));
  } catch (e) { /* storage is best-effort */ }
}

function load() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return;
    const s = JSON.parse(raw);
    player.applySaveState(s.player);
    missions.applySaveState(s.missions);
    if (typeof s.clockMin === 'number') clockMin = s.clockMin;
  } catch (e) { /* ignore a bad save */ }
}

// ---- overlays ----------------------------------------------------------------
const overlays = {
  start: document.getElementById('overlay-start'),
  pause: document.getElementById('overlay-pause'),
  mission: document.getElementById('overlay-mission'),
  busted: document.getElementById('overlay-busted'),
  wasted: document.getElementById('overlay-wasted'),
};

function showOnly(name) {
  for (const [key, el] of Object.entries(overlays)) {
    if (el) el.classList.toggle('hidden', key !== name);
  }
}

function respawn() {
  if (!player.onFoot && player.car) player.exitCar();
  const sp = city.spawnPoints.player;
  player.pos.set(sp.x, 0, sp.z);
  player.heading = sp.heading;
  player.group.rotation.y = sp.heading;
  player.health = CONFIG.player.health;
  player.dead = false;
  player.wanted = 0;
  police.reset();
  camYaw = player.heading;
  showOnly(null);
  mode = 'playing';
  save();
}

missions.onComplete = (m) => {
  save();
  const title = document.getElementById('mission-title');
  const reward = document.getElementById('mission-reward');
  const next = document.getElementById('mission-next');
  if (missions.allDone) {
    if (title) title.textContent = 'ALL JOBS DONE';
    if (reward) reward.textContent = `Total earned: $${Math.floor(player.money).toLocaleString('en-US')}`;
    if (next) next.textContent = 'Solmar is yours, Rico. Keep the city — or start over.';
  } else {
    if (title) title.textContent = `${m.name.toUpperCase()} — JOB DONE`;
    if (reward) reward.textContent = `+$${m.reward}`;
    const n = missions.current();
    if (next) next.textContent = n ? `Next job: ${n.name} — ${n.blurb}` : '';
  }
  showOnly('mission');
  mode = 'mission';
};

missions.onMissionStart = (m) => {
  if (mode === 'playing') hud.toast(`${m.name} — ${m.blurb}`);
};

overlays.start?.addEventListener('click', () => {
  audio.unlock();
  audio.click();
  showOnly(null);
  mode = 'playing';
});
overlays.mission?.addEventListener('click', () => {
  audio.click();
  showOnly(null);
  mode = 'playing';
});
overlays.busted?.addEventListener('click', () => {
  audio.click();
  respawn();
});
overlays.wasted?.addEventListener('click', () => {
  audio.click();
  respawn();
});

// ---- input -------------------------------------------------------------------
const keys = new Set();
let dragging = false;
let lastPointerX = 0;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (mode !== 'playing') return;
  if (e.code === 'KeyE') {
    if (player.onFoot) {
      if (player.tryEnterCar(vehicles)) audio.click();
    } else {
      player.exitCar();
    }
  } else if (e.code === 'KeyF') {
    player.punch({ peds });
    audio.punch();
  } else if (e.code === 'KeyR') {
    player.startReload();
  } else if (e.code === 'KeyM') {
    muted = !muted;
    audio.setMuted(muted);
    hud.toast(muted ? 'Muted' : 'Sound on');
  } else if (e.code === 'Escape' || e.code === 'KeyP') {
    showOnly('pause');
    mode = 'paused';
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastPointerX = e.clientX;
});
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camYaw -= (e.clientX - lastPointerX) * 0.004;
  lastPointerX = e.clientX;
});
addEventListener('pointerup', () => { dragging = false; });
addEventListener('click', (e) => {
  if (mode !== 'playing' || !player.onFoot || dragging) return;
  if (e.target !== renderer.domElement) return;
  player.shoot({ peds });
  audio.gunshot();
});
addEventListener('keydown', (e) => {
  if ((e.code === 'Escape' || e.code === 'KeyP') && mode === 'paused') {
    showOnly(null);
    mode = 'playing';
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- simulation ---------------------------------------------------------------
function readInput() {
  return {
    f: keys.has('KeyW') || keys.has('ArrowUp'),
    b: keys.has('KeyS') || keys.has('ArrowDown'),
    l: keys.has('KeyA') || keys.has('ArrowLeft'),
    r: keys.has('KeyD') || keys.has('ArrowRight'),
    run: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    camHeading: camYaw,
  };
}

function tick(dt, input) {
  elapsed += dt;
  clockMin += dt * CONFIG.clock.minutesPerSecond;
  const world = { city, vehicles, peds };
  player.update(dt, input, world);
  vehicles.update(dt);
  peds.update(dt);
  police.update(dt);
  missions.update(dt);

  // health regrows after a quiet spell (no damage, no heat, 6 s)
  if (player.health < prevHealth) lastDamageAt = elapsed;
  prevHealth = player.health;
  if (player.wanted < 0.5 && elapsed - lastDamageAt > 6 && player.health > 0 && player.health < 100) {
    player.health = Math.min(100, player.health + 4 * dt);
  }
}

G.tick = tick;

// ---- camera ---------------------------------------------------------------------
const camPos = new THREE.Vector3(0, 4, -8);

function updateCamera(dt) {
  const target = player.pos;
  // camera follows the player's (or car's) heading unless the user drags
  const wantYaw = player.heading;
  let d = wantYaw - camYaw;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  camYaw += d * Math.min(1, 2.2 * dt);

  // higher + further back than a tight over-the-shoulder cam: the near
  // sidewalk used to fill the bottom third of the frame with flat tan
  const dist = player.onFoot ? 8.5 : 12.5;
  const height = player.onFoot ? 4.3 : 5.6;
  const bx = target.x - Math.sin(camYaw) * dist;
  const bz = target.z - Math.cos(camYaw) * dist;
  camPos.x += (bx - camPos.x) * Math.min(1, 8 * dt);
  camPos.y += ((height) - camPos.y) * Math.min(1, 8 * dt);
  camPos.z += (bz - camPos.z) * Math.min(1, 8 * dt);
  camera.position.copy(camPos);
  camera.lookAt(
    target.x + Math.sin(camYaw) * 7,
    target.y + 1.3,
    target.z + Math.cos(camYaw) * 7,
  );
}

// ---- main loop -------------------------------------------------------------------
let last = performance.now();
let acc = 0;
let autosaveTimer = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - last);
  last = now;
  const dt = dtMs / 1000;

  if (mode === 'playing') {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      tick(STEP, readInput());
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0;

    // busted / wasted transitions
    if (police.busted) {
      const lost = Math.floor(player.money * 0.1);
      player.money -= lost;
      const bt = document.getElementById('busted-text');
      if (bt) bt.textContent = lost > 0 ? `The Solmar PD took you in. You lost $${lost}.` : 'The Solmar PD took you in.';
      audio.busted();
      showOnly('busted');
      mode = 'busted';
      save();
    } else if (player.dead) {
      const lost = Math.floor(player.money * 0.1);
      player.money -= lost;
      const wt = document.getElementById('wasted-text');
      if (wt) wt.textContent = lost > 0 ? `You got wasted. The hospital bill cost $${lost}.` : 'You got wasted.';
      audio.wasted();
      showOnly('wasted');
      mode = 'wasted';
      save();
    }

    autosaveTimer += dt;
    if (autosaveTimer > 10) {
      autosaveTimer = 0;
      save();
    }
  }

  updateCamera(dt);
  if (mode === 'playing' || mode === 'paused' || mode === 'mission') {
    hud.update(dt, { player, missions, police, clockMin });
  }
  audio.engine(player.speedKmh, !player.onFoot && mode === 'playing');
  audio.siren(police.sirenOn && mode === 'playing');

  renderer.render(scene, camera);

  if (SHOT_MODE && !shotReady) {
    shotReady = true;
    window.__shotReady = true;
  }
}

// ---- start -------------------------------------------------------------------------
if (SHOT_MODE) {
  showOnly(null);
  mode = 'playing';
  stageShot(SHOT, G, SEED);
  camYaw = player.heading;
  const sp = player.pos;
  camPos.set(sp.x - Math.sin(camYaw) * 11, 4.6, sp.z - Math.cos(camYaw) * 11);
} else {
  load();
  showOnly('start');
}

requestAnimationFrame(frame);
