import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pointer, watch, makeRenderer, studioLight, damp, clamp, ease, rng } from './util.js';
import { paintType } from './type.js';
import { makeScreen } from './screen.js';
import { HANDLE } from './cartridges.js';

// Buttermax-style hero: black ink chases the cursor across a butter-yellow page while a
// see-through handheld floats in the middle. The handheld is the site's controller: its buttons
// press, its screen is a pixel display, and cartridges drop into its slot. The ink is a metaball
// field drawn on a backdrop plane inside the same scene, so the glass shell refracts it.

const DROPS = 28;
const NB = DROPS + 4;          // main blob + 3 satellites + trailing droplets
const PLANE_Z = -1.5;
const MELT_TIME = 0.9;
const SLOT_Y = 1.48;           // cartridge centre when seated: 0.38 sticks out of the top
const SLOT_OUT = 3;            // lift that takes it out of view

const vertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const inkFragment = /* glsl */`
uniform sampler2D uBaseA;
uniform sampler2D uBaseB;
uniform sampler2D uHideA;
uniform sampler2D uHideB;
uniform float uMorph;
uniform vec2 uSize;
uniform vec3 uBlobs[NB];
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uCream;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }

// one layer of type melting from A into B: each column drips away at its own moment
// while the next type pours in from just above
float melt(sampler2D a, sampler2D b, vec2 uv) {
  float n = noise(uv.x * 18.0) * 0.6 + noise(uv.x * 63.0) * 0.4;
  float p = clamp(uMorph * 1.7 - n * 0.7, 0.0, 1.0);
  float gone = texture2D(a, uv + vec2(0.0, p * p * 0.45)).a * (1.0 - smoothstep(0.35, 0.9, p));
  float come = texture2D(b, uv - vec2(0.0, (1.0 - p) * (1.0 - p) * 0.12)).a * smoothstep(0.25, 0.85, p);
  return max(gone, come);
}

void main() {
  vec2 p = vUv * uSize;
  float f = 0.0;
  for (int i = 0; i < NB; i++) {
    vec2 d = p - uBlobs[i].xy;
    float r = uBlobs[i].z;
    f += r * r / (dot(d, d) + 1.0);
  }
  // threshold in log space: the raw field spikes at blob centres and blows up fwidth
  float lf = log(max(f, 1e-6));
  float w = fwidth(lf) * 0.75;
  float ink = smoothstep(-w, w, lf);

  // inside the ink the hidden layer is bent toward the edge, like looking through a drop
  vec2 grad = vec2(dFdx(lf), dFdy(lf));
  float lens = (1.0 - smoothstep(0.0, 0.95, lf)) * ink;
  vec2 shift = normalize(grad + 1e-5) * lens * 14.0 / uSize;

  float base = melt(uBaseA, uBaseB, vUv);
  float hidden = melt(uHideA, uHideB, vUv + shift);
  vec3 col = mix(uPaper, uInk, base);
  col = mix(col, mix(uInk, uCream, hidden), ink);

  // a thin wet rim just inside the edge
  float rim = ink - smoothstep(w * 2.0, w * 5.0, lf);
  col = mix(col, uCream, clamp(rim, 0.0, 1.0) * 0.35);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const screenFragment = /* glsl */`
uniform float uTime;
uniform sampler2D uUI;
varying vec2 vUv;
void main() {
  vec2 q = (floor(vUv * vec2(80.0, 72.0)) + 0.5) / vec2(80.0, 72.0);
  float t = uTime * 0.35;
  float v = sin(q.x * 7.0 + t * 2.0) + sin(q.y * 9.0 - t * 1.7);
  v += sin(length(q - vec2(0.5 + 0.3 * sin(t), 0.5 + 0.3 * cos(t * 1.3))) * 16.0 - t * 3.0);
  vec3 col = 0.55 + 0.45 * cos(6.2831 * (v * 0.16 + vec3(0.0, 0.33, 0.67)));
  col = pow(mix(col, vec3(1.0, 0.86, 0.78), 0.3), vec3(2.2));
  vec4 ui = texture2D(uUI, vUv);
  col = mix(col, ui.rgb, step(0.5, ui.a));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export function hero(section, initial) {
  const canvas = section.querySelector('canvas');
  const seen = watch(section);
  const renderer = makeRenderer(canvas, { maxDpr: 1.5 });
  const scene = new THREE.Scene();
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.z = 10;
  const sun = new THREE.DirectionalLight('#fff2dc', 1.6);
  sun.position.set(-3, 4, 6);
  scene.add(sun);

  // ---- type: what you see (base) and what only the ink shows (hide); A is current, B is next
  const layer = () => { const c = document.createElement('canvas'); return { canvas: c, tex: new THREE.CanvasTexture(c) }; };
  let baseA = layer(), baseB = layer(), hideA = layer(), hideB = layer();
  const blobs = Array.from({ length: NB }, () => new THREE.Vector3());
  const uniforms = {
    uBaseA: { value: baseA.tex }, uBaseB: { value: baseB.tex },
    uHideA: { value: hideA.tex }, uHideB: { value: hideB.tex },
    uMorph: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uBlobs: { value: blobs },
    uPaper: { value: new THREE.Color('#ffb41f') },
    uInk: { value: new THREE.Color('#0e0e0e') },
    uCream: { value: new THREE.Color('#fff1dc') },
  };
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    defines: { NB }, uniforms, vertexShader: vertex, fragmentShader: inkFragment,
  }));
  backdrop.position.z = PLANE_Z;
  scene.add(backdrop);

  // ---- the handheld, its screen and its cartridge
  const device = buildDevice();
  scene.add(device.group);
  const screen = makeScreen();
  device.screen.material.uniforms.uUI.value = screen.tex;
  const cart = buildCart();
  cart.group.position.set(0, SLOT_Y + SLOT_OUT, -0.21);
  device.group.add(cart.group);
  device.targets.push(...cart.hits);
  const slot = { lift: SLOT_OUT, v: 0, target: SLOT_OUT, next: null, current: null };
  // turning the console over: dragged by hand or sent by the controller
  const flip = { a: 0, v: 0, target: 0, dragging: false, base: 0 };

  // shared with the controller and the screen
  const state = {
    mode: 'home', index: -1, cursor: 0, carts: [], toast: null, toastUntil: 0,
    flashUntil: 0, slotAt: 0, paused: false,
  };

  let W = 1, H = 1, baseY = 0;
  const main = { x: 0, y: 0, vx: 0, vy: 0 };
  const sats = [0, 1, 2].map(() => ({ x: 0, y: 0 }));
  const drops = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0 }));
  let head = 0, travelled = 0;
  const tilt = { x: 0, y: 0 };
  const pressed = {};

  // ---- melting between contents
  let content = initial, next = null, melt = -1;   // melt < 0: idle
  // three.js allocates fixed storage on a texture's first upload, so a canvas that changes size
  // needs its texture released or the new pixels never reach the GPU
  function paint(base, hide, c) {
    for (const [l, hidden] of [[base, false], [hide, true]]) {
      const w = l.canvas.width, h = l.canvas.height;
      paintType(l.canvas, c, W, H, hidden);
      if (l.canvas.width !== w || l.canvas.height !== h) l.tex.dispose();
      l.tex.needsUpdate = true;
    }
  }
  function bind() {
    uniforms.uBaseA.value = baseA.tex; uniforms.uBaseB.value = baseB.tex;
    uniforms.uHideA.value = hideA.tex; uniforms.uHideB.value = hideB.tex;
    uniforms.uMorph.value = melt < 0 ? 0 : ease(melt);
  }
  // finish a running melt at once: B becomes the current layer
  function settle() {
    if (melt < 0) return;
    [baseA, baseB] = [baseB, baseA];
    [hideA, hideB] = [hideB, hideA];
    content = next; next = null; melt = -1;
    bind();
  }
  function show(c) {
    settle();
    next = c;
    paint(baseB, hideB, c);
    melt = 0;
    bind();
  }

  function resize() {
    W = section.clientWidth; H = section.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(camera.fov / 2);
    const back = 2 * (camera.position.z - PLANE_Z) * Math.tan(fov);
    backdrop.scale.set(back * camera.aspect, back, 1);
    uniforms.uSize.value.set(W, H);
    const vh = 2 * camera.position.z * Math.tan(fov);
    device.group.scale.setScalar(Math.min(vh * 0.62 / 3.1, vh * camera.aspect * 0.7 / 2));
    baseY = -vh * 0.08;
    if (!main.x) {
      main.x = W * 0.66; main.y = H * 0.42;
      for (const s of sats) { s.x = main.x; s.y = main.y; }
    }
    settle();
    paint(baseA, hideA, content);
  }
  new ResizeObserver(resize).observe(section);
  resize();

  // ---- picking buttons under the pointer
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height * 2 - 1));
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(device.targets, false)[0];
    if (!hit) return null;
    const name = hit.object.userData.button;
    if (name !== 'dpad') return name;
    const p = device.dpad.worldToLocal(hit.point.clone());
    return Math.abs(p.x) > Math.abs(p.y) ? (p.x > 0 ? 'right' : 'left') : (p.y > 0 ? 'up' : 'down');
  }

  // flip to the back (on) or the front; the angle keeps winding so a spin never snaps backwards
  function flipTo(on) {
    let k = Math.round(flip.a / Math.PI);
    if (on !== (Math.abs(k) % 2 === 1)) k += 1;
    flip.target = k * Math.PI;
  }
  function dragStart() { flip.dragging = true; flip.base = flip.a; flip.v = 0; }
  function dragTo(angle) { flip.a = flip.base + angle; }
  function dragEnd() {
    flip.dragging = false;
    const k = Math.round(flip.a / Math.PI);
    flip.target = k * Math.PI;
    return Math.abs(k) % 2 === 1;
  }

  // where the console's screen is on the page, for the viewer to open from
  const at = new THREE.Vector3();
  function screenPoint() {
    device.screen.getWorldPosition(at).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (at.x + 1) / 2 * r.width, y: r.top + (1 - at.y) / 2 * r.height };
  }

  function insert(c) { slot.next = c; slot.target = SLOT_OUT; }
  function eject() { slot.next = null; slot.target = SLOT_OUT; }
  function press(name) { pressed[name] = 1; }
  function splash() {
    const R = Math.min(W, H) * 0.13;
    for (let k = 0; k < 7; k++) {
      const d = drops[head];
      head = (head + 1) % DROPS;
      const a = Math.random() * Math.PI * 2, speed = 400 + Math.random() * 500;
      d.x = main.x; d.y = main.y;
      d.vx = Math.cos(a) * speed; d.vy = Math.sin(a) * speed;
      d.r = R * (0.2 + Math.random() * 0.15);
      d.life = 1;
    }
  }

  function tick(t, dt) {
    if (!seen.on || state.paused) return;
    const rect = section.getBoundingClientRect();
    const R = Math.min(W, H) * 0.13;

    // the main blob springs toward the pointer, or wanders when nobody is moving
    let tx, ty;
    if (performance.now() - pointer.last > 2500) {
      tx = W * (0.66 + 0.16 * Math.sin(t * 0.37));
      ty = H * (0.42 + 0.1 * Math.sin(t * 0.61));
    } else {
      tx = pointer.x - rect.left;
      ty = H - (pointer.y - rect.top);
    }
    main.vx += ((tx - main.x) * 70 - main.vx * 11) * dt;
    main.vy += ((ty - main.y) * 70 - main.vy * 11) * dt;
    main.x += main.vx * dt;
    main.y += main.vy * dt;
    const speed = Math.hypot(main.vx, main.vy);

    // satellites lag behind, which stretches the blob into a tail when it moves
    sats.forEach((s, i) => {
      const a = t * (0.45 + i * 0.3) + i * 2.094;
      const d = R * (0.62 + 0.22 * Math.sin(t * (1.1 + i * 0.4) + i * 1.7));
      s.x = damp(s.x, main.x + Math.cos(a) * d, 3 + i * 1.5, dt);
      s.y = damp(s.y, main.y + Math.sin(a) * d, 3 + i * 1.5, dt);
    });

    // shed droplets along the path
    travelled += speed * dt;
    if (travelled > R * 0.42 && speed > 60) {
      travelled = 0;
      const d = drops[head];
      head = (head + 1) % DROPS;
      d.x = main.x - main.vx / speed * R * 0.9;
      d.y = main.y - main.vy / speed * R * 0.9;
      d.vx = main.vx * 0.06; d.vy = main.vy * 0.06;
      d.r = R * clamp(0.16 + speed / 9000, 0.16, 0.36);
      d.life = 1;
    }

    let i = 0;
    blobs[i++].set(main.x, main.y, R * (0.9 + 0.05 * Math.sin(t * 2.1)));
    sats.forEach((s, k) => blobs[i++].set(s.x, s.y, R * (0.42 + k * 0.07)));
    for (const d of drops) {
      if (d.life > 0) {
        d.life -= dt / 1.5;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.vx *= 0.96; d.vy *= 0.96;
      }
      // drop it before it is small enough to alias into a speck
      const r = d.life > 0 ? d.r * Math.sqrt(d.life) : 0;
      blobs[i++].set(d.x, d.y, r > R * 0.1 ? r : 0);
    }

    // type melt
    if (melt >= 0) {
      melt += dt / MELT_TIME;
      if (melt >= 1) settle(); else uniforms.uMorph.value = ease(melt);
    }

    // cartridge: rise out of view, swap, drop back in with a little bounce
    if (slot.target === SLOT_OUT && slot.lift > SLOT_OUT - 0.4 && slot.next) {
      cart.paint(slot.next);
      slot.current = slot.next; slot.next = null;
      slot.target = 0;
    }
    slot.v += ((slot.target - slot.lift) * 90 - slot.v * 12) * dt;
    slot.lift += slot.v * dt;
    cart.group.position.y = SLOT_Y + slot.lift;
    cart.group.visible = slot.lift < SLOT_OUT - 0.1;

    // buttons: quick press, spring back
    for (const k in pressed) pressed[k] = Math.max(0, pressed[k] - dt * 6);
    const amt = k => Math.min(1, (pressed[k] || 0) * 1.6);
    device.dpad.rotation.y = (amt('right') - amt('left')) * 0.22;
    device.dpad.rotation.x = (amt('down') - amt('up')) * 0.22;
    for (const [k, b] of Object.entries(device.buttons)) b.obj.position.z = b.rest - 0.04 * amt(k);

    // the handheld leans toward the pointer, on top of however far it has been turned over
    if (!flip.dragging) {
      flip.v += ((flip.target - flip.a) * 60 - flip.v * 11) * dt;
      flip.a += flip.v * dt;
    }
    tilt.y = damp(tilt.y, pointer.nx * 0.45 + Math.sin(t * 0.5) * 0.12, 3, dt);
    tilt.x = damp(tilt.x, -pointer.ny * 0.3 + Math.sin(t * 0.7) * 0.06, 3, dt);
    device.group.rotation.set(tilt.x, tilt.y + flip.a, 0.06 + Math.sin(t * 0.4) * 0.03);
    device.group.position.y = baseY + Math.sin(t * 1.1) * 0.05;

    device.screen.material.uniforms.uTime.value = t;
    screen.draw(state, t);
    renderer.render(scene, camera);
  }

  function refresh() {
    settle();
    paint(baseA, hideA, content);
    if (slot.current) cart.paint(slot.current);
    device.repaint();
  }

  return {
    canvas, state, tick, refresh, pick, press, show, insert, eject, splash,
    flipTo, dragStart, dragTo, dragEnd, screenPoint,
  };
}

function buildDevice() {
  const group = new THREE.Group();
  const rand = rng(7);
  const W = 2.0, H = 3.1, D = 0.42;

  // translucent, slightly pink, iridescent shell; grabbing it turns the console over
  const shell = new THREE.Mesh(
    new RoundedBoxGeometry(W, H, D, 6, 0.16),
    new THREE.MeshPhysicalMaterial({
      color: '#ffe6ee', transmission: 1, roughness: 0.1, thickness: 0.3, ior: 1.35,
      iridescence: 1, iridescenceIOR: 1.25, iridescenceThicknessRange: [120, 420],
      clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 0.45,
    }),
  );
  shell.userData.button = 'shell';
  group.add(shell);

  // circuit board with gold traces
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.22, H - 0.22, 0.04),
    new THREE.MeshStandardMaterial({ map: traceTexture(rand), roughness: 0.55, metalness: 0.3 }),
  );
  pcb.position.z = -0.12;
  group.add(pcb);

  const chipMats = [
    new THREE.MeshStandardMaterial({ color: '#18181a', roughness: 0.4 }),
    new THREE.MeshStandardMaterial({ color: '#b9b9be', metalness: 1, roughness: 0.3 }),
    new THREE.MeshStandardMaterial({ color: '#c8a24c', metalness: 1, roughness: 0.35 }),
  ];
  for (let i = 0; i < 18; i++) {
    const w = 0.08 + rand() * 0.3, h = 0.08 + rand() * 0.25, d = 0.03 + rand() * 0.07;
    const chip = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), chipMats[rand() < 0.65 ? 0 : rand() < 0.6 ? 1 : 2]);
    chip.position.set((rand() - 0.5) * (W - 0.6), -1.35 + rand() * 1.3, -0.1 + d / 2);
    group.add(chip);
  }

  const shellWhite = new THREE.MeshStandardMaterial({ color: '#f1ede7', roughness: 0.45 });
  const keyWhite = new THREE.MeshStandardMaterial({ color: '#e6e2db', roughness: 0.35 });
  const targets = [shell];
  const hit = (geo, button) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
    m.visible = false;              // raycasts still hit invisible meshes
    m.userData.button = button;
    targets.push(m);
    return m;
  };

  // screen: 160×144 like a Game Boy
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.62, 1.3, 0.05, 3, 0.02), shellWhite);
  bezel.position.set(0, 0.62, 0.02);
  group.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.08),
    new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uUI: { value: null } }, vertexShader: vertex, fragmentShader: screenFragment }),
  );
  screen.position.set(0, 0.62, 0.05);
  group.add(screen);
  const glass = hit(new THREE.PlaneGeometry(1.3, 1.16), 'screen');   // in front of the shell, which would catch the ray first
  glass.position.set(0, 0.62, 0.23);
  group.add(glass);

  // d-pad on a round seat; it tilts toward the arm you press
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 40), shellWhite);
  seat.rotation.x = Math.PI / 2;
  seat.position.set(-0.52, -0.62, 0.17);
  group.add(seat);
  const dpad = new THREE.Group();
  dpad.position.set(-0.52, -0.62, 0.2);
  for (const rot of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.16, 0.08, 2, 0.03), keyWhite);
    bar.rotation.z = rot;
    dpad.add(bar);
  }
  const pad = hit(new THREE.CircleGeometry(0.34, 24), 'dpad');
  pad.position.z = 0.05;
  dpad.add(pad);
  group.add(dpad);

  // face buttons in SNES order, each with its letter
  const buttons = {};
  for (const [id, x, y] of [['a', 0.7, -0.62], ['b', 0.52, -0.8], ['x', 0.52, -0.44], ['y', 0.34, -0.62]]) {
    const b = new THREE.Group();
    b.position.set(x, y, 0.2);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 28), keyWhite);
    cap.rotation.x = Math.PI / 2;
    const letter = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 24),
      new THREE.MeshStandardMaterial({ map: letterTexture(id.toUpperCase()), alphaTest: 0.5, roughness: 0.4 }),
    );
    letter.position.z = 0.041;
    const h = hit(new THREE.CircleGeometry(0.12, 20), id);
    h.position.z = 0.05;
    b.add(cap, letter, h);
    group.add(b);
    buttons[id] = { obj: b, rest: 0.2 };
  }

  // select / start
  for (const [id, x] of [['select', -0.16], ['start', 0.16]]) {
    const b = new THREE.Group();
    b.position.set(x, -1.18, 0.19);
    b.rotation.z = -0.4;
    const h = hit(new THREE.PlaneGeometry(0.34, 0.2), id);
    h.position.z = 0.03;
    b.add(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.05, 2, 0.025), chipMats[1]), h);
    group.add(b);
    buttons[id] = { obj: b, rest: 0.19 };
  }

  // the back, seen when the console is turned over to its about side: a label and a battery cover
  const label = stickerTexture();
  // (kept below y ≈ 1.0, where a seated cartridge covers the back)
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.625), new THREE.MeshStandardMaterial({ map: label.tex, roughness: 0.7 }));
  sticker.position.set(0, 0.15, -0.218);
  sticker.rotation.y = Math.PI;
  const cover = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.56, 0.03, 2, 0.012), new THREE.MeshStandardMaterial({ color: '#d9d3c9', roughness: 0.5 }));
  cover.position.set(0, -1.1, -0.215);
  group.add(sticker, cover);

  return { group, screen, dpad, buttons, targets, repaint: label.paint };
}

function stickerTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 640;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  function paint() {
    const x = c.getContext('2d');
    x.fillStyle = '#f3ede2'; x.fillRect(0, 0, 512, 640);
    x.fillStyle = '#ffb41f'; x.fillRect(0, 0, 512, 22);
    x.fillStyle = '#0e0e0e';
    x.font = '900 92px "Inter Tight", Arial, sans-serif';
    x.fillText('MOLTEN', 30, 132);
    x.font = '600 20px "Inter Tight", Arial, sans-serif';
    ['MODEL  MLT-01', `MADE BY  @${HANDLE.toUpperCase()}`, 'SWIFT · THREE.JS · GODOT', 'PLAYS  FOLIO · TERM · THRESHOLD', 'MADE IN 2026']
      .forEach((row, i) => { x.fillText(row, 34, 194 + i * 42); x.fillRect(34, 206 + i * 42, 444, 1); });
    const rand = rng(11);
    for (let bx = 34; bx < 330;) {
      const w = 2 + Math.floor(rand() * 5);
      if (rand() > 0.35) x.fillRect(bx, 470, w, 110);
      bx += w + 2;
    }
    x.font = '600 16px "Inter Tight", Arial, sans-serif';
    x.fillText('0 26 MOLTEN 01', 34, 606);
    tex.needsUpdate = true;
  }
  paint();
  return { tex, paint };
}

// a cartridge in the project's colour with a cream label on the part that sticks out
function buildCart() {
  const group = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.55 });
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512; labelCanvas.height = 128;
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 4;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.325), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.6 }));
  label.position.set(0, 0.24, 0.061);
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.9, 0.12, 3, 0.04), shell);
  body.userData.button = label.userData.button = 'cart';   // clicking the cartridge pulls it out
  group.add(body, label);

  function paint(cart) {
    shell.color.set(cart.color);
    const c = labelCanvas.getContext('2d');
    c.fillStyle = '#fff1dc'; c.fillRect(0, 0, 512, 128);
    c.fillStyle = cart.color; c.fillRect(0, 0, 512, 16);
    c.fillStyle = '#0e0e0e';
    c.textBaseline = 'middle';
    c.font = '900 60px "Inter Tight", Arial, sans-serif';
    c.textAlign = 'left';
    c.fillText(cart.name.toUpperCase(), 24, 74);
    c.font = '600 20px "Inter Tight", Arial, sans-serif';
    c.textAlign = 'right';
    c.fillText(cart.kind, 488, 74);
    labelTex.needsUpdate = true;
  }
  return { group, paint, hits: [body, label] };
}

function letterTexture(ch) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#8f897f';
  x.font = '700 40px "Inter Tight", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(ch, 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function traceTexture(rand) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 800;
  const x = c.getContext('2d');
  x.fillStyle = '#2b201b';
  x.fillRect(0, 0, 512, 800);
  x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round';
  for (let i = 0; i < 70; i++) {
    let px = rand() * 512, py = rand() * 800;
    x.strokeStyle = `rgba(190, 150, 70, ${0.45 + rand() * 0.55})`;
    x.beginPath();
    x.moveTo(px, py);
    for (let k = 0; k < 4; k++) {
      if (rand() < 0.5) px += (rand() - 0.5) * 220; else py += (rand() - 0.5) * 220;
      x.lineTo(px, py);
    }
    x.stroke();
    x.fillStyle = '#d4ad55';
    x.beginPath(); x.arc(px, py, 5, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
