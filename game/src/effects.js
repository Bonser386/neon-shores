// Neon Shores — particles, screen shake, glow sprites, neon sign textures.
// All visual, no gameplay state: a singleton (FX) the world modules call into.
// Particles are two THREE.Points systems (smoke: normal blending, sparks:
// additive) driven by a small shader with per-particle size and alpha, so a
// puff can grow and fade without a texture atlas or a draw call per particle.

import * as THREE from '../vendor/three.module.min.js';

// ---------------------------------------------------------------------------
// shared radial glow texture (soft white disc, for lamp glow + neon halos)
// ---------------------------------------------------------------------------
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// An additive glow sprite, tinted `color`, `scale` metres across.
export function makeGlowSprite(color, scale, opacity = 0.5) {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale, scale, 1);
  return s;
}

// A neon sign face: bright text with a glow halo on a transparent canvas.
export function neonSignTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.font = '800 40px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 34);
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A wide neon banner (for the gateway arches): the font auto-fits so the
// text fills the canvas instead of sitting small in the middle of it.
export function neonBannerTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 80;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 512, 80);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  ctx.font = `800 ${size}px Arial, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > 0) size = Math.min(64, Math.floor((64 * 460) / w));
  ctx.font = `800 ${size}px Arial, sans-serif`;
  ctx.shadowColor = color;
  ctx.shadowBlur = 18;
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 42);
  ctx.shadowBlur = 6;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, 256, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// particle system (one Points cloud per blend mode)
// ---------------------------------------------------------------------------
const VERT = `
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  if (a < 0.015) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class ParticleSystem {
  constructor(max, blending) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.p = [];
    for (let i = 0; i < max; i++) {
      this.p.push({ life: 0, maxLife: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, r: 1, g: 1, b: 1, grav: 0, drag: 0, a0: 1 });
      this.pos[i * 3 + 1] = -999;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.geo = geo;
  }

  spawn(x, y, z, vx, vy, vz, life, size, grow, r, g, b, grav, drag, a0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const q = this.p[i];
    q.life = life;
    q.maxLife = life;
    q.x = x; q.y = y; q.z = z;
    q.vx = vx; q.vy = vy; q.vz = vz;
    q.size = size; q.grow = grow;
    q.r = r; q.g = g; q.b = b;
    q.grav = grav; q.drag = drag; q.a0 = a0;
  }

  update(dt) {
    const { pos, col, size, alpha, p } = this;
    for (let i = 0; i < this.max; i++) {
      const q = p[i];
      if (q.life <= 0) {
        if (alpha[i] !== 0) { alpha[i] = 0; pos[i * 3 + 1] = -999; }
        continue;
      }
      q.life -= dt;
      if (q.life <= 0) { alpha[i] = 0; pos[i * 3 + 1] = -999; continue; }
      q.vy -= q.grav * dt;
      const d = Math.max(0, 1 - q.drag * dt);
      q.vx *= d; q.vy *= d; q.vz *= d;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      q.size += q.grow * dt;
      const t = q.life / q.maxLife;
      pos[i * 3] = q.x;
      pos[i * 3 + 1] = q.y;
      pos[i * 3 + 2] = q.z;
      col[i * 3] = q.r;
      col[i * 3 + 1] = q.g;
      col[i * 3 + 2] = q.b;
      size[i] = q.size;
      alpha[i] = q.a0 * t;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// the singleton the game calls
// ---------------------------------------------------------------------------
class Effects {
  constructor() {
    this.smoke = null;
    this.sparks = null;
    this.trauma = 0;
  }

  init(scene) {
    if (this.smoke) return;
    this.smoke = new ParticleSystem(500, THREE.NormalBlending);
    this.sparks = new ParticleSystem(500, THREE.AdditiveBlending);
    scene.add(this.smoke.points, this.sparks.points);
  }

  // grey tyre smoke, drifting up and growing as it fades
  puff(x, y, z) {
    if (!this.smoke) return;
    for (let i = 0; i < 2; i++) {
      this.smoke.spawn(
        x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 1.2, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2,
        0.9 + Math.random() * 0.6, 0.9, 1.6,
        0.42, 0.42, 0.48, -1.5, 0.6, 0.32,
      );
    }
  }

  // hot impact sparks: fast, orange, fall with gravity, burn out quickly
  burst(x, y, z, n = 14) {
    if (!this.sparks) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 10;
      const warm = Math.random();
      this.sparks.spawn(
        x, y + 0.3, z,
        Math.cos(a) * sp, 2 + Math.random() * 7, Math.sin(a) * sp,
        0.3 + Math.random() * 0.45, 0.32, 0,
        1.0, 0.55 + warm * 0.35, 0.15, 14, 0.4, 1.0,
      );
    }
  }

  // small muzzle flash sparks at the gun
  muzzle(x, y, z, heading) {
    if (!this.sparks) return;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (let i = 0; i < 5; i++) {
      this.sparks.spawn(
        x + fx * (0.6 + Math.random() * 0.5), y, z + fz * (0.6 + Math.random() * 0.5),
        fx * (6 + Math.random() * 6) + (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2,
        fz * (6 + Math.random() * 6) + (Math.random() - 0.5) * 2,
        0.12 + Math.random() * 0.1, 0.3, 0,
        1.0, 0.85, 0.45, 0, 0, 1.0,
      );
    }
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  // decaying random offset for the camera, scaled by trauma squared
  shakeOffset() {
    const s = this.trauma * this.trauma * 0.55;
    if (s <= 0.001) return { x: 0, y: 0 };
    return { x: (Math.random() * 2 - 1) * s, y: (Math.random() * 2 - 1) * s * 0.6 };
  }

  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    if (this.smoke) this.smoke.update(dt);
    if (this.sparks) this.sparks.update(dt);
  }
}

export const FX = new Effects();
