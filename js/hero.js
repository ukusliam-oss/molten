import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pointer, watch, makeRenderer, studioLight, damp, clamp, ease, rng } from './util.js';
import { paintType, typeBottom } from './type.js';
import { makeScreen, labelArt } from './screen.js';
import { makeFluid } from './fluid.js';
import { sfx } from './sound.js';
import { HANDLE } from './cartridges.js';

// Buttermax-style hero, rebuilt on what buttermax.net actually runs (read from its shaders):
// · ink = the dye of a fluid simulation the pointer stirs; dye ≥ 0.5 is ink, 0.4–0.5 turns the
//   type an animated rainbow, the type inside the ink is white, and the flow drags the type a little;
// · where ink crosses the console, the console breaks into jittering hot pixel blocks;
// · a hair of chromatic split everywhere, more near a fast pointer.
// The handheld is the controller: its buttons press, its screen is an LCD, cartridges seat in its slot.

const PLANE_Z = -1.5;
const MELT_TIME = 0.9;
const CART_W = 1.5, CART_H = 1.7, CART_D = 0.12;
const SLOT_TOP = 1.55;                         // the console's top edge
const SHOW = 0.72;                             // how much of a seated cartridge sticks out
const SLOT_Y = SLOT_TOP + SHOW - CART_H / 2;   // cartridge centre when seated
const SLOT_OUT = 3.4;                          // lift that takes it out of view
const PEEK = 0.34;                             // lift while hovered, to show the label art
const IDLE_MS = 6000;                          // after this long without a pointer, a ghost stirs the ink
const PEEK_AFTER_SEAT = 1.6;                   // touch screens can't hover: show the label once, after it seats
const TOUCH = matchMedia('(hover: none)').matches;

const vertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const inkFragment = /* glsl */`
uniform sampler2D uBaseA;
uniform sampler2D uBaseB;
uniform sampler2D uHideA;
uniform sampler2D uHideB;
uniform sampler2D tDye;
uniform sampler2D tVel;
uniform float uMorph;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uWhite;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash(i), hash(i + 1.0), f); }
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

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
  float d = texture2D(tDye, vUv).r;
  vec2 flow = texture2D(tVel, vUv).xy;
  float w = max(fwidth(d), 1e-4);
  float ink = smoothstep(0.5 - w, 0.5 + w, d);
  float rim = smoothstep(0.4 - w, 0.4 + w, d) * (1.0 - ink);

  vec2 drag = flow * 0.00005;   // the flow pulls the type along a little
  float base = melt(uBaseA, uBaseB, vUv + drag);
  float hidden = melt(uHideA, uHideB, vUv + drag * 2.0);

  // Buttermax's rim: red pushed round the hue wheel by time, dye and position
  float hue = (0.5 + sin(uTime * 10.0 + d * 20.0 + vUv.x) * 6.0) * 0.08;
  vec3 rainbow = pow(hsv2rgb(vec3(fract(hue), 0.85, 1.0)), vec3(2.2));

  vec3 col = mix(uPaper, mix(uInk, rainbow, rim), base);
  col = mix(col, mix(uInk, uWhite, hidden), ink);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

// the console's display: the pixel canvas over an iridescent idle pattern, shown as an LCD
// that the ink's flow ripples and splits into colour fringes
const screenFragment = /* glsl */`
uniform float uTime;
uniform sampler2D uUI;
uniform sampler2D tVel;
uniform vec2 uView;
varying vec2 vUv;
void main() {
  vec2 flow = texture2D(tVel, gl_FragCoord.xy / uView).xy;
  vec2 uv = vUv + flow * 0.00006;
  vec2 q = (floor(uv * vec2(80.0, 72.0)) + 0.5) / vec2(80.0, 72.0);
  float t = uTime * 0.35;
  float v = sin(q.x * 7.0 + t * 2.0) + sin(q.y * 9.0 - t * 1.7);
  v += sin(length(q - vec2(0.5 + 0.3 * sin(t), 0.5 + 0.3 * cos(t * 1.3))) * 16.0 - t * 3.0);
  vec3 col = 0.55 + 0.45 * cos(6.2831 * (v * 0.16 + vec3(0.0, 0.33, 0.67)));
  col = pow(mix(col, vec3(1.0, 0.86, 0.78), 0.3), vec3(2.2));

  float split = 0.0022 + min(length(flow), 400.0) * 0.000012;
  vec4 ui = texture2D(uUI, uv);
  vec3 lcd = vec3(texture2D(uUI, uv + vec2(split, 0.0)).r, ui.g, texture2D(uUI, uv - vec2(split, 0.0)).b);
  col = mix(col, lcd, step(0.5, ui.a));

  // pixel rows, only where the screen is large enough to hold them without moiré
  float rows = vUv.y * 144.0;
  float scan = 1.0 - 0.16 * (1.0 - smoothstep(0.3, 0.6, fwidth(rows))) * smoothstep(0.25, 0.5, abs(fract(rows) - 0.5));
  col *= scan;
  // a slow sheen across the glass
  float s = vUv.x + vUv.y * 0.6 - fract(uTime * 0.06) * 2.8 + 0.6;
  col += smoothstep(0.18, 0.0, abs(s)) * 0.05;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const compositeFragment = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tMask;
uniform sampler2D tDye;
uniform vec2 uRes;
uniform vec2 uMouse;
uniform float uSpeed;
uniform float uTime;
uniform float uDpr;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
// three.js's ACES fit, applied to the console only: the page's flat colours stay exact
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(OUT * RRTAndODTFit(IN * (c / 0.6)), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  vec2 mask = texture2D(tMask, uv).rg;    // r: the console, g: its buttons, which never break up
  float depth = smoothstep(0.32, 0.95, texture2D(tDye, uv).r);
  float glitch = mask.r * (1.0 - mask.g) * depth;

  // where ink crosses the console it dissolves into its own pixels: fine at the ink's rim,
  // coarser deeper in, and every so often a row tears sideways
  float level = glitch < 0.03 ? 0.0 : glitch < 0.35 ? 1.0 : glitch < 0.7 ? 2.0 : 3.0;
  float n = 0.0;
  if (level > 0.0) {
    float size = (level == 1.0 ? 4.0 : level == 2.0 ? 8.0 : 13.0) * uDpr;
    vec2 cell = floor(uv * uRes / size);
    float tick = floor(uTime * 8.0);
    n = hash(cell + tick);
    float tear = step(0.9, hash(vec2(cell.y, tick))) * (hash(vec2(tick, cell.y)) - 0.5) * (level - 1.0);
    uv = (cell + 0.5 + vec2(tear, 0.0)) * size / uRes;
  }

  // chromatic split only while something moves: near a fast pointer, and inside the pixels
  vec2 dir = uv - uMouse;
  float dist = length(dir);
  dir /= max(dist, 1e-4);
  float amt = uSpeed * 0.0022 * smoothstep(0.45, 0.0, dist) + glitch * 0.0025;
  vec3 c = vec3(texture2D(tScene, uv + dir * amt).r, texture2D(tScene, uv).g, texture2D(tScene, uv - dir * amt).b);

  c = mix(c, aces(c), texture2D(tMask, uv).r);
  if (level > 0.0) {
    c = mix(c, floor(c * 6.0 + 0.5) / 6.0, 0.35 + 0.2 * level);                         // fewer tones, like its screen
    c = mix(c, c * vec3(1.12, 0.86, 0.55) + vec3(0.05, 0.02, 0.0) * n, glitch * 0.4);   // warming toward #ffa200
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export function hero(section, initial) {
  const canvas = section.querySelector('canvas');
  const seen = watch(section);
  const renderer = makeRenderer(canvas, { maxDpr: 2 });   // full Retina: at 1.5 the console was drawn at 75% and stretched
  renderer.toneMapping = THREE.NoToneMapping;   // tone mapping happens in the composite, on the console only
  const scene = new THREE.Scene();
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.z = 10;
  const sun = new THREE.DirectionalLight('#fff2dc', 1.6);
  sun.position.set(-3, 4, 6);
  scene.add(sun);

  const fluid = makeFluid(renderer);

  // ---- type: what you see (base) and what only the ink shows (hide); A is current, B is next
  const layer = () => { const c = document.createElement('canvas'); return { canvas: c, tex: new THREE.CanvasTexture(c) }; };
  let baseA = layer(), baseB = layer(), hideA = layer(), hideB = layer();
  const uniforms = {
    uBaseA: { value: baseA.tex }, uBaseB: { value: baseB.tex },
    uHideA: { value: hideA.tex }, uHideB: { value: hideB.tex },
    tDye: { value: null }, tVel: { value: null },
    uMorph: { value: 0 }, uTime: { value: 0 },
    uPaper: { value: new THREE.Color('#ffb41f') },
    uInk: { value: new THREE.Color('#0e0e0e') },
    uWhite: { value: new THREE.Color('#ffffff') },
  };
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    uniforms, vertexShader: vertex, fragmentShader: inkFragment,
  }));
  backdrop.position.z = PLANE_Z;
  scene.add(backdrop);

  // ---- the handheld, its screen and its cartridge
  const device = buildDevice();
  scene.add(device.group);
  const screen = makeScreen();
  const screenU = device.screen.material.uniforms;
  screenU.uUI.value = screen.tex;
  const cart = buildCart();
  cart.group.position.set(0, SLOT_Y + SLOT_OUT, -0.22);
  device.group.add(cart.group);
  device.targets.push(...cart.hits);
  cart.group.traverse(o => { if (o.isMesh) o.layers.enable(2); });
  const slot = { lift: SLOT_OUT, v: 0, target: SLOT_OUT, next: null, current: null, seated: false, hover: false, peekUntil: 0, labelDone: true, labelAt: 0 };
  const flip = { a: 0, v: 0, target: 0, dragging: false, base: 0 };
  let bump = 0;

  // ---- passes: scene → MSAA target, the console alone → a mask, then the composite to the screen
  const buffer = new THREE.Vector2();
  const mainRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const maskRT = new THREE.WebGLRenderTarget(1, 1);
  const maskBody = new THREE.MeshBasicMaterial({ color: 0xff0000 });   // r: the console
  // g: its buttons (layer 1). No depth test: the d-pad's seat sits just inside the glass shell
  const maskKeys = new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: false });
  // the cartridge is pressable too (layer 2) — depth-tested, so only the part above the console counts
  const maskCart = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const composite = new THREE.ShaderMaterial({
    uniforms: {
      tScene: { value: mainRT.texture }, tMask: { value: maskRT.texture }, tDye: { value: null },
      uRes: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uSpeed: { value: 0 }, uTime: { value: 0 }, uDpr: { value: 1 },
    },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: compositeFragment,
    depthTest: false, depthWrite: false,
  });
  const post = new THREE.Scene();
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), composite);
  postQuad.frustumCulled = false;
  post.add(postQuad);
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // shared with the controller and the screen
  const state = {
    mode: 'home', index: -1, cursor: 0, carts: [], toast: null, toastUntil: 0,
    flashUntil: 0, slotAt: 0, paused: false,
  };

  let W = 1, H = 1, baseY = 0;
  const tilt = { x: 0, y: 0 };
  const pressed = {};
  const stir = { x: null, y: null, ghost: false, speed: 0 };

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
    renderer.getDrawingBufferSize(buffer);
    mainRT.setSize(buffer.x, buffer.y);
    maskRT.setSize(buffer.x, buffer.y);   // full size, so the console's edges keep their own colour
    composite.uniforms.uRes.value.copy(buffer);
    composite.uniforms.uDpr.value = renderer.getPixelRatio();
    screenU.uView.value.copy(buffer);
    fluid.resize(W, H);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(camera.fov / 2);
    const back = 2 * (camera.position.z - PLANE_Z) * Math.tan(fov);
    backdrop.scale.set(back * camera.aspect, back, 1);
    const vh = 2 * camera.position.z * Math.tan(fov);
    let scale = Math.min(vh * 0.6 / 3.1, vh * camera.aspect * 0.7 / 2);
    baseY = -vh * 0.1;
    // on narrow screens the console would sit on the title's line of text: put the seated cartridge's top
    // just under it, and shrink the console if it would then run into the corner labels
    if (camera.aspect < 1.15) {
      const ppu = H / vh;
      const reach = SLOT_TOP + SHOW + 0.05;
      const under = vh / 2 - (typeBottom(W, H) + 16) / ppu;
      const floor = -vh / 2 + 46 / ppu;
      scale = Math.min(scale, (under - floor) / (reach + 1.6));
      baseY = under - reach * scale;
    }
    device.group.scale.setScalar(scale);
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

  // a point on the console, in page pixels
  const at = new THREE.Vector3();
  function project(obj, local) {
    at.copy(local);
    obj.localToWorld(at).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (at.x + 1) / 2 * r.width, y: r.top + (1 - at.y) / 2 * r.height };
  }
  const screenPoint = () => project(device.screen, new THREE.Vector3());
  const mouthPoint = () => project(device.group, new THREE.Vector3(0, SLOT_TOP, 0));

  // a ring of ink thrown out from a point (page pixels)
  function burst(p, strength = 1) {
    const r = canvas.getBoundingClientRect();
    const x = (p.x - r.left) / W, y = 1 - (p.y - r.top) / H;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + Math.random() * 0.4;
      const reach = 0.012 + Math.random() * 0.02;
      const fx = Math.cos(a) * 900 * strength, fy = Math.sin(a) * 900 * strength + 260 * strength;
      fluid.splat(x + Math.cos(a) * reach, y + Math.sin(a) * reach, x, y, fx, fy, 0.06 + Math.random() * 0.03, 4 * strength);
    }
  }

  function insert(c) { slot.next = c; slot.target = SLOT_OUT; }
  function eject() {
    slot.next = null; slot.target = SLOT_OUT;
    if (slot.seated) burst(mouthPoint(), 0.6);
  }
  function press(name) { pressed[name] = 1; }
  function hoverCart(on) { slot.hover = on; }

  // the console and a seated cartridge on the page, in hero pixels, padded by a brush width
  const corners = [[-1.05, SLOT_TOP + SHOW + 0.05], [1.05, SLOT_TOP + SHOW + 0.05], [-1.05, -1.6], [1.05, -1.6]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const box = { l: 0, r: 0, t: 0, b: 0 };
  function consoleBox(rect) {
    box.l = box.t = Infinity; box.r = box.b = -Infinity;
    for (const c of corners) {
      const p = project(device.group, c);
      box.l = Math.min(box.l, p.x - rect.left); box.r = Math.max(box.r, p.x - rect.left);
      box.t = Math.min(box.t, p.y - rect.top); box.b = Math.max(box.b, p.y - rect.top);
    }
    const pad = H * 0.07;
    box.l -= pad; box.r += pad; box.t -= pad; box.b += pad;
    return box;
  }
  const inBox = (x, y) => x > box.l && x < box.r && y > box.t && y < box.b;

  // ---- the pointer (or the idle ghost) stirs the fluid, the way MouseFluid does
  function feed(t, rect) {
    const idle = performance.now() - pointer.last > IDLE_MS;
    if (idle !== stir.ghost) { stir.ghost = idle; stir.x = null; }
    let x, y;
    if (idle) {                          // a lazy figure-eight across the wordmark
      x = W * (0.5 + 0.44 * Math.sin(t * 0.5));
      y = H * (0.3 + 0.16 * Math.sin(t * 0.9 + 1.3));
    } else {
      x = pointer.x - rect.left;
      y = pointer.y - rect.top;
    }
    if (stir.x === null) { stir.x = x; stir.y = y; return; }
    const dx = x - stir.x, dy = y - stir.y, len = Math.hypot(dx, dy);
    stir.speed = damp(stir.speed, clamp(len / 30), 8, 1 / 60);
    // the ghost lifts its brush over the console, so an idle page never pixelates the screen you're reading
    const penUp = idle && (consoleBox(rect), inBox(x, y) || inBox(stir.x, stir.y));
    if (len > 0.01 && len < 420 && !penUp) {
      const cap = W < 720 ? 18 : 30;                              // Buttermax uses a smaller brush on phones
      const radius = Math.min(clamp(len / 5) * 60, cap) / 200;    // Math.range(len, 0, 5, 0, 60), capped
      const force = clamp(len / 15) * 10;                        // Math.range(len, 0, 15, 0, 10)
      fluid.splat(x / W, 1 - y / H, stir.x / W, 1 - stir.y / H, dx * force, -dy * force, radius, 1);
    }
    stir.x = x; stir.y = y;
    composite.uniforms.uMouse.value.set(x / W, 1 - y / H);
    composite.uniforms.uSpeed.value = stir.speed;
  }

  function tick(t, dt) {
    if (!seen.on || state.paused) return;
    const rect = section.getBoundingClientRect();

    feed(t, rect);
    fluid.step(dt);
    uniforms.tDye.value = fluid.dye;
    uniforms.tVel.value = fluid.velocity;
    uniforms.uTime.value = t;
    screenU.tVel.value = fluid.velocity;
    composite.uniforms.tDye.value = fluid.dye;
    composite.uniforms.uTime.value = t;

    // type melt
    if (melt >= 0) {
      melt += dt / MELT_TIME;
      if (melt >= 1) settle(); else uniforms.uMorph.value = ease(melt);
    }

    // cartridge: rise out of view, swap, drop back in, click into the slot
    if (slot.target === SLOT_OUT && slot.lift > SLOT_OUT - 0.5 && slot.next) {
      slot.labelDone = cart.paint(slot.next);
      slot.current = slot.next; slot.next = null;
      slot.target = 0; slot.seated = false;
    }
    if (!slot.labelDone && t - slot.labelAt > 0.5) { slot.labelAt = t; slot.labelDone = cart.paint(slot.current); }
    const want = slot.target === 0 && (slot.hover || t < slot.peekUntil) ? PEEK : slot.target;
    slot.v += ((want - slot.lift) * 90 - slot.v * 12) * dt;
    slot.lift += slot.v * dt;
    if (slot.target === 0 && !slot.seated && slot.lift < 0.03 && slot.v < 0) {
      slot.seated = true;
      if (TOUCH) slot.peekUntil = t + PEEK_AFTER_SEAT;
      bump = 1;
      sfx.seat();
      burst(mouthPoint());
    }
    if (slot.target !== 0) slot.seated = false;
    cart.group.position.y = SLOT_Y + slot.lift;
    cart.group.rotation.z = clamp(slot.v * 0.01, -0.1, 0.1) * clamp(slot.lift / 0.4);
    cart.group.visible = slot.lift < SLOT_OUT - 0.1;

    // buttons: quick press, spring back
    for (const k in pressed) pressed[k] = Math.max(0, pressed[k] - dt * 6);
    const amt = k => Math.min(1, (pressed[k] || 0) * 1.6);
    device.dpad.rotation.y = (amt('right') - amt('left')) * 0.22;
    device.dpad.rotation.x = (amt('down') - amt('up')) * 0.22;
    for (const [k, b] of Object.entries(device.buttons)) b.obj.position.z = b.rest - 0.04 * amt(k);

    // the handheld leans toward the pointer, on top of however far it has been turned over,
    // and dips when a cartridge clicks home
    if (!flip.dragging) {
      flip.v += ((flip.target - flip.a) * 60 - flip.v * 11) * dt;
      flip.a += flip.v * dt;
    }
    bump = Math.max(0, bump - dt * 3.5);
    tilt.y = damp(tilt.y, pointer.nx * 0.45 + Math.sin(t * 0.5) * 0.12, 3, dt);
    tilt.x = damp(tilt.x, -pointer.ny * 0.3 + Math.sin(t * 0.7) * 0.06, 3, dt);
    device.group.rotation.set(tilt.x + Math.sin(bump * Math.PI) * 0.05, tilt.y + flip.a, 0.06 + Math.sin(t * 0.4) * 0.03);
    device.group.position.y = baseY + Math.sin(t * 1.1) * 0.05 - Math.sin(bump * Math.PI) * 0.07;

    screenU.uTime.value = t;
    screen.draw(state, t);

    // the console alone, as a mask for the pixels and the tone mapping; then its buttons on top,
    // only while the front faces us (turned over, they are behind the shell)
    backdrop.visible = false;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(maskRT);
    scene.overrideMaterial = maskBody;
    renderer.render(scene, camera);
    renderer.autoClear = false;
    if (Math.cos(flip.a) > 0) {
      scene.overrideMaterial = maskKeys;
      camera.layers.set(1);
      renderer.render(scene, camera);
    }
    scene.overrideMaterial = maskCart;
    camera.layers.set(2);
    renderer.render(scene, camera);
    renderer.autoClear = true;
    camera.layers.set(0);
    scene.overrideMaterial = null;
    backdrop.visible = true;

    renderer.setRenderTarget(mainRT);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(post, postCamera);
  }

  function refresh() {
    settle();
    paint(baseA, hideA, content);
    if (slot.current) slot.labelDone = cart.paint(slot.current);
    device.repaint();
  }

  return {
    canvas, state, tick, refresh, pick, press, show, insert, eject, hoverCart,
    flipTo, dragStart, dragTo, dragEnd, screenPoint,
  };
}

function buildDevice() {
  const group = new THREE.Group();
  const rand = rng(7);
  const W = 2.0, H = 3.1, D = 0.42, F = D / 2;   // F: the front surface of the shell

  // clear, slightly pink, iridescent shell — nearly polished, so the board inside reads sharp
  // through it (rough glass is sampled from a blurred mip of the scene behind it)
  const shell = new THREE.Mesh(
    new RoundedBoxGeometry(W, H, D, 10, 0.16),
    new THREE.MeshPhysicalMaterial({
      color: '#ffe9f0', transmission: 1, roughness: 0.015, thickness: 0.18, ior: 1.38,
      iridescence: 1, iridescenceIOR: 1.25, iridescenceThicknessRange: [120, 420],
      clearcoat: 0.6, clearcoatRoughness: 0.04, envMapIntensity: 0.45,
    }),
  );
  shell.userData.button = 'shell';
  group.add(shell);

  // the board: traces, vias, pads and silkscreen
  const pcb = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.22, H - 0.22, 0.04),
    new THREE.MeshStandardMaterial({ map: traceTexture(rand), roughness: 0.5, metalness: 0.25 }),
  );
  pcb.position.z = -0.12;
  group.add(pcb);

  // parts on the board: marked chips, silver cans, gold crystals and a scatter of passives
  const black = new THREE.MeshStandardMaterial({ color: '#141416', roughness: 0.45 });
  const silver = new THREE.MeshStandardMaterial({ color: '#c3c3c8', metalness: 1, roughness: 0.28 });
  const goldM = new THREE.MeshStandardMaterial({ color: '#cfa64e', metalness: 1, roughness: 0.32 });
  const tan = new THREE.MeshStandardMaterial({ color: '#b68a52', roughness: 0.5 });
  const marks = ['MLT-8B', 'MOLTEN', 'INK·01', 'SRAM 64K', 'LCD DRV', 'APU 2A'].map(t => chipTexture(t, rand));
  for (let i = 0; i < 18; i++) {
    const w = 0.08 + rand() * 0.3, h = 0.08 + rand() * 0.25, d = 0.03 + rand() * 0.07;
    const k = rand();
    let mat = k < 0.65 ? black : k < 0.86 ? silver : goldM;
    if (mat === black && w > 0.18 && h > 0.12) {   // a printed face on the bigger chips
      const face = new THREE.MeshStandardMaterial({ map: marks[i % marks.length], roughness: 0.45 });
      mat = [black, black, black, black, face, black];
    }
    const chip = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    chip.position.set((rand() - 0.5) * (W - 0.6), -1.35 + rand() * 1.3, -0.1 + d / 2);
    group.add(chip);
  }
  for (let i = 0; i < 40; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.025, 0.02), rand() < 0.6 ? tan : black);
    p.position.set((rand() - 0.5) * (W - 0.4), -1.42 + rand() * 1.45, -0.09);
    p.rotation.z = rand() < 0.5 ? 0 : Math.PI / 2;
    group.add(p);
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
  // decals printed on the clear case
  const print = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, depthWrite: false }));

  // screen: 160×144 like a Game Boy, set on the front surface (not behind the glass, which would refract
  // and soften it), in a printed bezel with the power LED
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.62, 1.3, 0.03, 4, 0.03), new THREE.MeshStandardMaterial({ map: bezelTexture(), roughness: 0.5 }));
  bezel.position.set(0, 0.62, F + 0.005);
  group.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.2, 1.08),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uUI: { value: null }, tVel: { value: null }, uView: { value: new THREE.Vector2(1, 1) } },
      vertexShader: vertex, fragmentShader: screenFragment,
    }),
  );
  screen.position.set(0, 0.62, F + 0.0205);
  group.add(screen);
  const glass = hit(new THREE.PlaneGeometry(1.3, 1.16), 'screen');
  glass.position.set(0, 0.62, F + 0.03);
  group.add(glass);
  const led = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.01, 24),
    new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff2418', emissiveIntensity: 2.4, roughness: 0.3 }),
  );
  led.rotation.x = Math.PI / 2;
  led.position.set(-0.705, 0.86, F + 0.022);
  group.add(led);

  // the maker's mark under the screen, like "GAME BOY" on the original
  const logo = print(logoTexture(), 1.24, 0.2);
  logo.position.set(0, -0.155, F + 0.002);
  group.add(logo);

  // d-pad on a round seat; it tilts toward the arm you press
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 64), shellWhite);
  seat.rotation.x = Math.PI / 2;
  seat.position.set(-0.52, -0.62, F - 0.005);
  group.add(seat);
  const dpad = new THREE.Group();
  dpad.position.set(-0.52, -0.62, F + 0.015);
  for (const rot of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.16, 0.08, 4, 0.03), keyWhite);
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
    b.position.set(x, y, F + 0.012);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 48), keyWhite);
    cap.rotation.x = Math.PI / 2;
    const letter = new THREE.Mesh(
      new THREE.CircleGeometry(0.07, 32),
      new THREE.MeshStandardMaterial({ map: letterTexture(id.toUpperCase()), alphaTest: 0.5, roughness: 0.4 }),
    );
    letter.position.z = 0.041;
    const h = hit(new THREE.CircleGeometry(0.12, 20), id);
    h.position.z = 0.05;
    b.add(cap, letter, h);
    group.add(b);
    buttons[id] = { obj: b, rest: F + 0.012 };
  }

  // select / start, with their names printed under them
  for (const [id, x] of [['select', -0.16], ['start', 0.16]]) {
    const b = new THREE.Group();
    b.position.set(x, -1.18, F + 0.008);
    b.rotation.z = -0.4;
    const h = hit(new THREE.PlaneGeometry(0.34, 0.2), id);
    h.position.z = 0.03;
    b.add(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.05, 4, 0.025), silver), h);
    group.add(b);
    buttons[id] = { obj: b, rest: F + 0.008 };
    const name = print(wordTexture(id.toUpperCase()), 0.3, 0.06);
    name.position.set(x - Math.sin(0.4) * 0.09, -1.18 - Math.cos(0.4) * 0.09, F + 0.002);
    name.rotation.z = -0.4;
    group.add(name);
  }

  // the speaker grille, bottom right
  const slotMat = new THREE.MeshStandardMaterial({ color: '#0c0c0e', roughness: 0.6 });
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.26, 0.012, 2, 0.02), slotMat);
    s.position.set(0.36 + i * 0.07, -1.12 - i * 0.03, F + 0.003);   // clear of the rounded corner
    s.rotation.z = 0.5;
    group.add(s);
  }

  // the back, seen when the console is turned over: four screws and a label kept below a seated
  // cartridge (y < 0.57)
  const label = stickerTexture();
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), new THREE.MeshStandardMaterial({ map: label.tex, roughness: 0.7 }));
  sticker.position.set(0, -0.28, -F - 0.008);
  sticker.rotation.y = Math.PI;
  group.add(sticker);
  const slot = new THREE.MeshStandardMaterial({ color: '#3a3a3e', roughness: 0.5 });
  for (const [x, y] of [[-0.78, 0.4], [0.78, 0.4], [-0.78, -1.3], [0.78, -1.3]]) {
    const screw = new THREE.Group();
    const headM = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.014, 32), silver);
    headM.rotation.x = Math.PI / 2;
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.006), slot);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.006), slot);
    c1.position.z = c2.position.z = -0.008;
    screw.add(headM, c1, c2);
    screw.position.set(x, y, -F - 0.006);
    group.add(screw);
  }

  // the buttons go on layer 1 too, so the mask can keep them out of the ink's pixelation
  for (const obj of [seat, dpad, ...Object.values(buttons).map(b => b.obj)]) {
    obj.traverse(o => { if (o.isMesh && o.visible) o.layers.enable(1); });
  }

  return { group, screen, dpad, buttons, targets, repaint: label.paint };
}

// a 2× canvas texture drawn in logical units
function canvasTexture(w, h, draw, scale = 2) {
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const paint = () => {
    const x = c.getContext('2d');
    x.setTransform(scale, 0, 0, scale, 0, 0);
    x.clearRect(0, 0, w, h);
    draw(x, w, h);
    tex.needsUpdate = true;
  };
  paint();
  return { tex, paint };
}

function bezelTexture() {
  // 1.62 × 1.3 units; the screen window is 1.2 × 1.08 in the middle
  return canvasTexture(810, 650, (x, w, h) => {
    x.fillStyle = '#efeae3'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#16161a'; x.fillRect(105, 55, 600, 540);
    // two rules and the line every Game Boy has above its screen
    x.fillStyle = '#c23b5a'; x.fillRect(40, 22, 250, 4);
    x.fillStyle = '#3d3f8f'; x.fillRect(40, 30, 250, 4);
    x.fillStyle = '#c23b5a'; x.fillRect(520, 22, 250, 4);
    x.fillStyle = '#3d3f8f'; x.fillRect(520, 30, 250, 4);
    x.fillStyle = '#5b5a63';
    x.font = 'italic 600 15px "Inter Tight", Arial, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('INK MATRIX WITH STEREO SOUND', w / 2, 28);
    x.font = '600 12px "Inter Tight", Arial, sans-serif';
    x.fillText('POWER', 52, 210);
  }).tex;
}

function logoTexture() {
  return canvasTexture(620, 100, (x, w, h) => {
    x.fillStyle = '#f3ede4';
    x.textBaseline = 'alphabetic';
    x.font = '900 46px "Inter Tight", Arial, sans-serif';
    const mol = 'Mol', mw = x.measureText(mol).width;
    x.font = '400 60px "Mr Dafoe", cursive';
    const tw = x.measureText('ten').width;
    x.font = '900 22px "Inter Tight", Arial, sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '3px';
    const pw = x.measureText('POCKET').width;
    const x0 = (w - (mw + tw + 18 + pw)) / 2;
    x.font = '900 46px "Inter Tight", Arial, sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '-1px';
    x.fillText(mol, x0, 66);
    x.font = '400 60px "Mr Dafoe", cursive';
    if ('letterSpacing' in x) x.letterSpacing = '0px';
    x.fillStyle = '#ffb41f';
    x.fillText('ten', x0 + mw - 2, 62);
    x.fillStyle = '#f3ede4';
    x.font = '900 22px "Inter Tight", Arial, sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '3px';
    x.fillText('POCKET', x0 + mw + tw + 18, 64);
  }).tex;
}

function wordTexture(text) {
  return canvasTexture(150, 30, (x, w, h) => {
    x.fillStyle = '#f3ede4';
    x.font = '700 15px "Inter Tight", Arial, sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '1.5px';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, w / 2, h / 2);
  }).tex;
}

function chipTexture(text, rand) {
  const code = `${2600 + Math.floor(rand() * 99)} ${String.fromCharCode(65 + Math.floor(rand() * 26))}${Math.floor(rand() * 90 + 10)}`;
  return canvasTexture(256, 128, (x, w, h) => {
    x.fillStyle = '#17171a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2a2a2f'; x.beginPath(); x.arc(22, 22, 8, 0, 7); x.fill();   // pin 1
    x.fillStyle = '#a4a4ab';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 30px "Inter Tight", Arial, sans-serif';
    x.fillText(text, w / 2, h * 0.44);
    x.font = '500 17px "Inter Tight", Arial, sans-serif';
    x.fillText(code, w / 2, h * 0.74);
  }, 1).tex;
}

function stickerTexture() {
  return canvasTexture(512, 640, x => {
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
  });
}

// ---- the cartridge: a Game Boy cartridge in tinted clear plastic, so its board, ROM and gold
// fingers show through; a printed label in a recess, the embossed arrow and grip ridges
function cartShape() {
  const w = CART_W / 2, h = CART_H / 2, r = 0.06, cut = 0.24;
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - cut);            // the clipped corner every Game Boy cartridge has
  s.lineTo(w - cut, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

function buildCart() {
  const group = new THREE.Group();
  const front = CART_D / 2 + 0.018;

  const geo = new THREE.ExtrudeGeometry(cartShape(), {
    depth: CART_D, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.018, bevelSegments: 4, curveSegments: 14,
  });
  geo.translate(0, 0, -CART_D / 2);
  const plastic = new THREE.MeshPhysicalMaterial({
    color: '#888888', transmission: 0.62, roughness: 0.3, thickness: 0.35, ior: 1.46,
    attenuationColor: new THREE.Color('#888888'), attenuationDistance: 0.45,
    clearcoat: 0.5, clearcoatRoughness: 0.15, envMapIntensity: 0.6,
  });
  const body = new THREE.Mesh(geo, plastic);

  // inside: a board with its ROM, and the gold fingers along the bottom edge
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 0.02), new THREE.MeshStandardMaterial({ color: '#1e3a2b', roughness: 0.6, metalness: 0.2 }));
  board.position.set(0, -0.26, -0.012);
  const rom = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.45 }));
  rom.position.set(-0.16, -0.18, 0.012);
  const gold = new THREE.MeshStandardMaterial({ color: '#d9ad4f', metalness: 1, roughness: 0.25 });
  for (let i = 0; i < 16; i++) {
    const pin = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.022), gold);
    pin.position.set(-0.525 + i * 0.07, -0.74, -0.008);
    group.add(pin);
  }

  // emboss: the arrow at the top and ridges at the bottom, a lighter tint of the plastic
  const emboss = new THREE.MeshStandardMaterial({ color: '#aaaaaa', roughness: 0.4 });
  const arrow = new THREE.Shape();
  arrow.moveTo(-0.07, 0.04); arrow.lineTo(0.07, 0.04); arrow.lineTo(0, -0.05); arrow.closePath();
  const arrowMesh = new THREE.Mesh(new THREE.ShapeGeometry(arrow), emboss);
  arrowMesh.position.set(-0.52, 0.775, front + 0.001);
  for (let i = 0; i < 5; i++) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.022, 0.012), emboss);
    ridge.position.set(0, -0.66 - i * 0.045, front);
    group.add(ridge);
  }

  // the printed label in its recess
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 1024; labelCanvas.height = 1128;   // drawn at 2× (see paintLabel)
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  labelTex.colorSpace = THREE.SRGBColorSpace;
  labelTex.anisotropy = 8;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.3), new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.55 }));
  label.position.set(0, 0.04, front + 0.002);
  const recess = new THREE.Mesh(new THREE.PlaneGeometry(1.24, 1.36), new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.6, transparent: true, opacity: 0.22 }));
  recess.position.set(0, 0.04, front + 0.0005);

  // the back: a small sticker
  const backLabel = canvasTexture(256, 160, bx => {
    bx.fillStyle = '#f4ecdd'; bx.fillRect(0, 0, 256, 160);
    bx.fillStyle = '#0e0e0e';
    bx.font = '900 34px "Inter Tight", Arial, sans-serif'; bx.fillText('MOLTEN', 18, 52);
    bx.font = '600 13px "Inter Tight", Arial, sans-serif';
    ['GAME PAK · MLT-01', 'MADE IN 2026', 'DO NOT STIR WHILE HOT'].forEach((s, i) => bx.fillText(s, 18, 86 + i * 22));
  });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshStandardMaterial({ map: backLabel.tex, roughness: 0.6 }));
  back.position.set(0, 0.2, -front - 0.002);
  back.rotation.y = Math.PI;

  body.userData.button = label.userData.button = 'cart';   // clicking the cartridge pulls it out
  group.add(body, board, rom, arrowMesh, recess, label, back);

  // returns whether the label is complete (its art may still be loading)
  function paint(cart) {
    const col = new THREE.Color(cart.color);
    plastic.color.copy(col);
    plastic.attenuationColor.copy(col);
    emboss.color.copy(col).lerp(new THREE.Color('#ffffff'), 0.35);
    backLabel.paint();
    return paintLabel(labelCanvas.getContext('2d'), cart, labelTex);
  }
  return { group, paint, hits: [body, label] };
}

function paintLabel(c, cart, tex) {
  const W = 512, H = 564, INK = '#0e0e0e', PAPER = '#f4ecdd';
  const n = String(cart.index + 1).padStart(2, '0');
  c.save();
  c.setTransform(2, 0, 0, 2, 0, 0);   // the canvas is 2×: draw in label units
  c.fillStyle = PAPER; c.fillRect(0, 0, W, H);
  // paper grain
  const rand = rng(cart.id.length * 31 + 7);
  for (let i = 0; i < 900; i++) {
    c.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.035})`;
    c.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 1);
  }
  c.strokeStyle = INK; c.lineWidth = 5; c.strokeRect(10, 10, W - 20, H - 20);

  // band: the system, the cartridge number (the part that shows above a seated cartridge)
  c.fillStyle = cart.color; c.fillRect(20, 20, W - 40, 96);
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.font = '900 40px "Inter Tight", Arial, sans-serif';
  c.fillText('Mol', 40, 70);
  const mw = c.measureText('Mol').width;
  c.font = '400 54px "Mr Dafoe", cursive';
  c.fillText('ten', 40 + mw - 2, 64);
  c.font = '600 17px "Inter Tight", Arial, sans-serif';
  c.textAlign = 'right';
  c.fillText(`GAME PAK ${n}`, W - 40, 58);
  c.fillText(cart.kind, W - 40, 82);
  c.textAlign = 'left';

  // the title, as large as it fits
  c.fillStyle = INK;
  let size = 96;
  c.font = `900 ${size}px "Inter Tight", Arial, sans-serif`;
  const tw = c.measureText(cart.name.toUpperCase()).width;
  if (tw > W - 80) { size = Math.floor(size * (W - 80) / tw); c.font = `900 ${size}px "Inter Tight", Arial, sans-serif`; }
  c.textBaseline = 'alphabetic';
  c.fillText(cart.name.toUpperCase(), 38, 128 + size * 0.86);

  // the art: the app's real screen, dithered like the console shows it; or a drawn one
  const ax = 38, ay = 252, aw = W - 76, ah = 228;
  const art = labelArt(cart, 192, 100);
  let done = true;
  c.fillStyle = INK; c.fillRect(ax - 4, ay - 4, aw + 8, ah + 8);
  if (art) {
    c.imageSmoothingEnabled = false;
    c.drawImage(art, ax, ay, aw, ah);
    c.imageSmoothingEnabled = true;
  } else {
    done = !cart.shots.length;
    c.fillStyle = cart.screen; c.fillRect(ax, ay, aw, ah);
    c.fillStyle = PAPER; c.fillRect(ax + 60, ay + 26, aw - 120, ah - 52);
    c.fillStyle = cart.color;
    c.font = '20px "Press Start 2P", monospace';
    c.fillText('Q3', ax + 80, ay + 66);
    c.textAlign = 'right'; c.fillText('[4]', ax + aw - 80, ay + 66); c.textAlign = 'left';
    for (let r = 0; r < 5; r++) c.fillRect(ax + 80, ay + 88 + r * 20, aw - 160 - ((r * 37) % 90), 6);
  }

  // the small print
  c.fillStyle = INK;
  c.font = '600 15px "Inter Tight", Arial, sans-serif';
  c.fillText('1 PLAYER', 38, H - 42);
  c.textAlign = 'right';
  c.fillText(`@${HANDLE.toUpperCase()}`, W - 38, H - 42);
  c.textAlign = 'left';
  c.restore();
  tex.needsUpdate = true;
  return done;
}

function letterTexture(ch) {
  return canvasTexture(64, 64, x => {
    x.fillStyle = '#8f897f';
    x.font = '700 40px "Inter Tight", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(ch, 32, 35);
  }, 3).tex;
}

// the board's copper: traces that jog at 45°, vias, pads for the chips and white silkscreen,
// drawn at 1024×1600 so it holds up behind the glass
function traceTexture(rand) {
  return canvasTexture(1024, 1600, (x, w, h) => {
    x.fillStyle = '#2a1f1a'; x.fillRect(0, 0, w, h);
    x.lineCap = 'round'; x.lineJoin = 'round';
    const gold = a => `rgba(196, 156, 76, ${a})`;
    for (let i = 0; i < 170; i++) {
      let px = rand() * w, py = rand() * h;
      x.strokeStyle = gold(0.35 + rand() * 0.5);
      x.lineWidth = rand() < 0.8 ? 2.5 : 5;
      x.beginPath();
      x.moveTo(px, py);
      for (let k = 0; k < 5; k++) {
        const len = 30 + rand() * 180, r = rand();
        if (r < 0.4) px += (rand() < 0.5 ? -1 : 1) * len;
        else if (r < 0.8) py += (rand() < 0.5 ? -1 : 1) * len;
        else { const d = (rand() < 0.5 ? -1 : 1) * len * 0.6; px += d; py += Math.abs(d) * (rand() < 0.5 ? -1 : 1); }
        x.lineTo(px, py);
      }
      x.stroke();
      x.fillStyle = gold(0.95);                       // a via at the end
      x.beginPath(); x.arc(px, py, 6, 0, 7); x.fill();
      x.fillStyle = '#1a120e';
      x.beginPath(); x.arc(px, py, 2.4, 0, 7); x.fill();
    }
    // pad rows where chips would sit
    for (let i = 0; i < 14; i++) {
      const cx = rand() * (w - 160) + 40, cy = rand() * (h - 120) + 40, n = 4 + Math.floor(rand() * 8);
      x.fillStyle = gold(0.9);
      for (let k = 0; k < n; k++) { x.fillRect(cx + k * 14, cy, 8, 18); x.fillRect(cx + k * 14, cy + 70, 8, 18); }
    }
    // silkscreen
    x.fillStyle = 'rgba(236, 230, 214, 0.75)';
    x.font = '600 20px "Inter Tight", Arial, sans-serif';
    for (let i = 0; i < 26; i++) {
      const t = ['C', 'R', 'U', 'L', 'Q'][Math.floor(rand() * 5)] + (1 + Math.floor(rand() * 40));
      x.fillText(t, rand() * (w - 60), rand() * h);
    }
    x.font = '700 26px "Inter Tight", Arial, sans-serif';
    x.fillText('MLT-01  REV.B', 60, h - 60);
    x.fillText('© 2026 MOLTEN', w - 300, h - 60);
    // mounting holes
    for (const [mx, my] of [[50, 50], [w - 50, 50], [50, h - 120], [w - 50, h - 120]]) {
      x.strokeStyle = gold(0.9); x.lineWidth = 6;
      x.beginPath(); x.arc(mx, my, 20, 0, 7); x.stroke();
      x.fillStyle = '#0d0907'; x.beginPath(); x.arc(mx, my, 13, 0, 7); x.fill();
    }
  }, 1).tex;
}
