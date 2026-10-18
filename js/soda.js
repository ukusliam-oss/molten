import * as THREE from 'three';
import { pointer, watch, makeRenderer, studioLight, clamp, range, ease, damp, lerp } from './util.js';

// MANA-style product section, pinned while you scroll through it:
// the can rises under the headline, tips over as the page turns the flavour colour,
// and the section becomes a flavour picker.

const FLAVOURS = [
  { name: 'Melon & Mint',  bg: '#ece46c', top: '#d2efa4', bottom: '#f3e35a', band: '#4c9a2a', ink: '#2c6612', pill: '#4a7d1f', deco: ['#f2603e', '#ff9b45', '#58a63a'] },
  { name: 'Yuzu & Ginger', bg: '#ffd47e', top: '#fff2b0', bottom: '#ffc04a', band: '#e8761c', ink: '#8f430a', pill: '#c45f12', deco: ['#ff6a3d', '#fff6d8', '#5f9e3a'] },
  { name: 'Peach & Basil', bg: '#f8c4bb', top: '#ffe2d6', bottom: '#f59a8b', band: '#d4504b', ink: '#7e2724', pill: '#b5433e', deco: ['#ff7f6b', '#ffd36e', '#4f9a45'] },
];
const CREAM = new THREE.Color('#fbe0d2');

function flower(c, x, y, r, color) {
  c.fillStyle = color;
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k * Math.PI * 2 / 5;
    c.beginPath(); c.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.8, 0, 7); c.fill();
  }
  c.fillStyle = '#fff8ee';
  c.beginPath(); c.arc(x, y, r * 0.45, 0, 7); c.fill();
}

function paintLabel(canvas, f) {
  const W = canvas.width, H = canvas.height;
  const c = canvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, f.top); g.addColorStop(1, f.bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  // band of repeating type, scaled so two repeats wrap the can exactly
  c.fillStyle = f.band;
  c.fillRect(0, 70, W, 150);
  const line = 'SPARKLING YERBA MATÉ  •  ORGANIC ENERGY  •  ';
  c.font = '600 64px "Inter Tight", Arial, sans-serif';
  const size = 64 * (W / 2) / c.measureText(line).width;
  c.font = `600 ${size}px "Inter Tight", Arial, sans-serif`;
  c.fillStyle = '#fff';
  c.textBaseline = 'middle';
  c.fillText(line, 0, 147);
  c.fillText(line, W / 2, 147);

  // two faces so it reads from either side
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  for (const x of [W * 0.25, W * 0.75]) {
    c.fillStyle = f.ink;
    c.font = '400 300px "Mr Dafoe", cursive';
    c.fillText('Molten', x, 560);
    c.font = '700 66px "Inter Tight", Arial, sans-serif';
    c.fillText(f.name.toUpperCase(), x, 730);
    c.font = '500 32px "Inter Tight", Arial, sans-serif';
    c.fillText('355 ML · 80 MG NATURAL CAFFEINE', x, 950);
  }
  for (const x of [0, W / 2, W]) {
    flower(c, x, 470, 62, f.deco[0]);
    flower(c, x + (x < W ? 120 : -120), 780, 36, f.deco[1]);
  }
}

function buildCan(labelTex) {
  const can = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#e4e4e4', metalness: 1, roughness: 0.25, side: THREE.DoubleSide });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 3, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.32, metalness: 0.25 }),
  );
  body.rotation.y = -Math.PI / 2;   // put the first face (u = 0.25) toward the camera
  const v = pts => pts.map(([x, y]) => new THREE.Vector2(x, y));
  const top = new THREE.LatheGeometry(v([[1, 1.5], [0.99, 1.6], [0.9, 1.78], [0.86, 1.86], [0.865, 1.93], [0.85, 1.97], [0.82, 1.96], [0.8, 1.9], [0, 1.9]]), 96);
  const bottom = new THREE.LatheGeometry(v([[0, -1.62], [0.6, -1.66], [0.78, -1.74], [0.84, -1.72], [0.95, -1.62], [1, -1.5]]), 96);
  const tab = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.22), metal);
  tab.position.set(0, 1.915, 0.22);
  can.add(body, new THREE.Mesh(top, metal), new THREE.Mesh(bottom, metal), tab);
  return can;
}

export function soda(section) {
  const pin = section.querySelector('.soda__pin');
  const canvas = section.querySelector('canvas');
  const nameEl = section.querySelector('.flavour');
  const seen = watch(section, '0px');
  const renderer = makeRenderer(canvas, { alpha: true, maxDpr: 2 });
  const scene = new THREE.Scene();
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 60);
  camera.position.z = 14;
  const key = new THREE.DirectionalLight('#fff6ea', 2);
  key.position.set(4, 6, 8);
  scene.add(key);

  const label = document.createElement('canvas');
  label.width = 2048; label.height = 1024;
  const labelTex = new THREE.CanvasTexture(label);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 8;
  const can = buildCan(labelTex);
  const holder = new THREE.Group();
  holder.add(can);
  scene.add(holder);

  let idx = 0, spin = 0, spinTarget = 0, vh = 7.5;
  const flavBg = new THREE.Color(FLAVOURS[0].bg), bg = new THREE.Color();

  function applyFlavour() {
    const f = FLAVOURS[idx];
    paintLabel(label, f);
    labelTex.needsUpdate = true;
    pin.style.setProperty('--pill', f.pill);
    f.deco.forEach((c, i) => pin.style.setProperty(`--d${i + 1}`, c));
    nameEl.textContent = f.name;
  }
  applyFlavour();

  section.querySelectorAll('[data-dir]').forEach(btn => btn.addEventListener('click', () => {
    const dir = Number(btn.dataset.dir);
    idx = (idx + dir + FLAVOURS.length) % FLAVOURS.length;
    spinTarget += dir * Math.PI * 2;
    setTimeout(applyFlavour, 160);   // swap the label mid-spin
  }));

  function resize() {
    const w = pin.clientWidth, h = pin.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    vh = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    holder.scale.setScalar(clamp(vh * camera.aspect / 6, 0.6, 1.1));
  }
  new ResizeObserver(resize).observe(pin);
  resize();

  function tick(t, dt) {
    if (!seen.on) return;
    const rect = section.getBoundingClientRect();
    const p = clamp(-rect.top / (rect.height - innerHeight));
    const rise = ease(range(p, 0, 0.32));
    const turn = ease(range(p, 0.36, 0.6));

    pin.style.setProperty('--intro', (1 - range(p, 0.3, 0.42)).toFixed(3));
    pin.style.setProperty('--ui', range(p, 0.5, 0.62).toFixed(3));
    pin.style.setProperty('--reveal', ease(range(p, 0.42, 0.66)).toFixed(3));
    pin.classList.toggle('ui-on', p > 0.5);

    flavBg.lerp(new THREE.Color(FLAVOURS[idx].bg), 1 - Math.exp(-5 * dt));
    pin.style.background = '#' + bg.copy(CREAM).lerp(flavBg, turn).getHexString();

    // a little hop while it spins to the next flavour
    spin = damp(spin, spinTarget, 5, dt);
    const hop = Math.sin(clamp(Math.abs(spinTarget - spin) / (Math.PI * 2)) * Math.PI) * 0.5;

    // start with only the lid peeking over the bottom edge
    const y0 = -vh / 2 - 1.2, y1 = -vh * 0.4, y2 = -0.15;
    holder.position.y = lerp(lerp(y0, y1, rise), y2, turn) + hop;
    holder.rotation.x = lerp(lerp(0.45, 0.18, rise), 0.25, turn) - pointer.ny * 0.06;
    holder.rotation.z = lerp(0, -1.05, turn) + pointer.nx * 0.08;
    can.rotation.y = spin + rise * 0.6 + turn * Math.PI * 2 + t * 0.25 * turn;

    renderer.render(scene, camera);
  }
  tick.refresh = applyFlavour;
  return tick;
}
