import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const range = (v, a, b) => clamp((v - a) / (b - a));
export const ease = t => t * t * (3 - 2 * t);
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

// One shared pointer for every scene. `last` lets scenes fall back to an idle path.
export const pointer = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0, last: -1e9 };
function move(x, y) {
  pointer.x = x; pointer.y = y;
  pointer.nx = x / innerWidth * 2 - 1;
  pointer.ny = -(y / innerHeight * 2 - 1);
  pointer.last = performance.now();
}
addEventListener('pointermove', e => move(e.clientX, e.clientY), { passive: true });
addEventListener('touchmove', e => { const t = e.touches[0]; if (t) move(t.clientX, t.clientY); }, { passive: true });

// Scenes only render while near the viewport, so the GPU idles everywhere else.
export function watch(el, margin = '120px') {
  const state = { on: false };
  new IntersectionObserver(([e]) => { state.on = e.isIntersecting; }, { rootMargin: margin }).observe(el);
  return state;
}

export function makeRenderer(canvas, { alpha = false, maxDpr = 2 } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio, maxDpr));
  r.toneMapping = THREE.ACESFilmicToneMapping;
  if (alpha) r.setClearColor(0x000000, 0);
  return r;
}

export function studioLight(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return tex;
}

// Seeded random so layouts stay the same between reloads.
export function rng(a = 1) {
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
