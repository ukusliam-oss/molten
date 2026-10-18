import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pointer, watch, makeRenderer, studioLight, damp, clamp, rng } from './util.js';

// Buttermax-style hero: black ink chases the cursor across a butter-yellow page and
// inverts the type it covers, while a see-through handheld floats in the middle.
// The ink is a metaball field drawn on a backdrop plane inside the same scene, so the
// glass shell refracts it.

const DROPS = 28;
const NB = DROPS + 4;          // main blob + 3 satellites + trailing droplets
const PLANE_Z = -1.5;

const vertex = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const inkFragment = /* glsl */`
uniform sampler2D uType;
uniform vec2 uSize;
uniform vec3 uBlobs[NB];
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uCream;
varying vec2 vUv;

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

  // inside the ink the type is bent toward the edge, like looking through a drop
  vec2 grad = vec2(dFdx(lf), dFdy(lf));
  float lens = (1.0 - smoothstep(0.0, 0.95, lf)) * ink;
  vec2 shift = normalize(grad + 1e-5) * lens * 14.0 / uSize;

  float base = texture2D(uType, vUv).a;
  float bent = texture2D(uType, vUv + shift).a;
  vec3 col = mix(uPaper, uInk, base);
  col = mix(col, mix(uInk, uCream, bent), ink);

  // a thin wet rim just inside the edge
  float rim = ink - smoothstep(w * 2.0, w * 5.0, lf);
  col = mix(col, uCream, clamp(rim, 0.0, 1.0) * 0.35);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const screenFragment = /* glsl */`
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 cell = vec2(48.0, 36.0);
  vec2 q = (floor(vUv * cell) + 0.5) / cell;
  float t = uTime * 0.35;
  float v = sin(q.x * 7.0 + t * 2.0) + sin(q.y * 9.0 - t * 1.7);
  v += sin(length(q - vec2(0.5 + 0.3 * sin(t), 0.5 + 0.3 * cos(t * 1.3))) * 16.0 - t * 3.0);
  vec3 col = 0.55 + 0.45 * cos(6.2831 * (v * 0.16 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, vec3(1.0, 0.86, 0.78), 0.3);
  vec2 g = fract(vUv * cell);
  col *= 0.86 + 0.14 * step(0.12, g.x) * step(0.12, g.y);
  gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
  #include <colorspace_fragment>
}`;

export function hero(section) {
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

  // ---- ink + type backdrop
  const blobs = Array.from({ length: NB }, () => new THREE.Vector3());
  const type = document.createElement('canvas');
  const typeTex = new THREE.CanvasTexture(type);
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    defines: { NB },
    uniforms: {
      uType: { value: typeTex },
      uSize: { value: new THREE.Vector2(1, 1) },
      uBlobs: { value: blobs },
      uPaper: { value: new THREE.Color('#ffb41f') },
      uInk: { value: new THREE.Color('#0e0e0e') },
      uCream: { value: new THREE.Color('#fff1dc') },
    },
    vertexShader: vertex,
    fragmentShader: inkFragment,
  }));
  backdrop.position.z = PLANE_Z;
  scene.add(backdrop);

  // ---- the handheld
  const device = buildDevice();
  scene.add(device.group);

  let W = 1, H = 1, baseY = 0;
  const main = { x: 0, y: 0, vx: 0, vy: 0 };
  const sats = [0, 1, 2].map(() => ({ x: 0, y: 0 }));
  const drops = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, vx: 0, vy: 0, r: 0, life: 0 }));
  let head = 0, travelled = 0;
  const tilt = { x: 0, y: 0 };

  function drawType() {
    const dpr = Math.min(devicePixelRatio, 2);
    type.width = Math.round(W * dpr);
    type.height = Math.round(H * dpr);
    const c = type.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#000';
    const spacing = v => { if ('letterSpacing' in c) c.letterSpacing = v + 'px'; };
    const heavy = s => `900 ${s}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
    const brush = s => `400 ${s * 1.32}px "Mr Dafoe", "Snell Roundhand", cursive`;
    const widths = s => {
      c.font = heavy(s); spacing(-s * 0.055);
      const a = c.measureText('Mol').width;
      c.font = brush(s); spacing(0);
      return [a, c.measureText('ten').width];
    };

    // wordmark: heavy grotesk + brush script, sized to the width like Buttermax
    const pad = clamp(W * 0.04, 16, 56);
    let [a, b] = widths(100);
    const s = Math.min((W - pad * 2) / (a + b - 4) * 94, H * 0.4);   // the brush tail overshoots its measured width
    [a, b] = widths(s);
    const overlap = s * 0.04;
    const x0 = (W - (a + b - overlap)) / 2;
    const base = Math.max(76, H * 0.12) + s * 0.76;
    c.font = heavy(s); spacing(-s * 0.055);
    c.fillText('Mol', x0, base);
    c.font = brush(s); spacing(0);
    c.fillText('ten', x0 + a - overlap, base - s * 0.05);

    const small = clamp(W * 0.0085, 10, 13);
    c.font = `600 ${small}px "Inter Tight", Arial, sans-serif`;
    spacing(small * 0.05);
    c.fillText('A SMALL STUDIO FOR WEBSITES THAT MOVE LIKE LIQUID.', x0 + s * 0.03, base + small * 2.4);
    c.fillText('3D · INTERACTION · MOTION', pad, H - pad);
    c.textAlign = 'right';
    c.fillText('SCROLL TO STIR ↓', W - pad, H - pad);
    c.textAlign = 'left';
    typeTex.needsUpdate = true;
  }

  function resize() {
    W = section.clientWidth; H = section.clientHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(camera.fov / 2);
    const back = 2 * (camera.position.z - PLANE_Z) * Math.tan(fov);
    backdrop.scale.set(back * camera.aspect, back, 1);
    backdrop.material.uniforms.uSize.value.set(W, H);
    const vh = 2 * camera.position.z * Math.tan(fov);
    device.group.scale.setScalar(Math.min(vh * 0.62 / 3.1, vh * camera.aspect * 0.7 / 2));
    baseY = -vh * 0.08;
    if (!main.x) {
      main.x = W * 0.66; main.y = H * 0.42;
      for (const s of sats) { s.x = main.x; s.y = main.y; }
    }
    drawType();
  }
  new ResizeObserver(resize).observe(section);
  resize();

  function tick(t, dt) {
    if (!seen.on) return;
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

    // the handheld leans toward the pointer and lifts away as you scroll
    const scroll = clamp(-rect.top / H);
    tilt.y = damp(tilt.y, pointer.nx * 0.45 + Math.sin(t * 0.5) * 0.12, 3, dt);
    tilt.x = damp(tilt.x, -pointer.ny * 0.3 + Math.sin(t * 0.7) * 0.06, 3, dt);
    device.group.rotation.set(tilt.x + scroll * 0.7, tilt.y, 0.06 + Math.sin(t * 0.4) * 0.03);
    device.group.position.y = baseY + Math.sin(t * 1.1) * 0.05 + scroll * 1.2;
    device.screen.material.uniforms.uTime.value = t;

    renderer.render(scene, camera);
  }
  tick.refresh = drawType;
  return tick;
}

function buildDevice() {
  const group = new THREE.Group();
  const rand = rng(7);
  const W = 2.0, H = 3.1, D = 0.42;

  // translucent, slightly pink, iridescent shell
  group.add(new THREE.Mesh(
    new RoundedBoxGeometry(W, H, D, 6, 0.16),
    new THREE.MeshPhysicalMaterial({
      color: '#ffe6ee', transmission: 1, roughness: 0.1, thickness: 0.3, ior: 1.35,
      iridescence: 1, iridescenceIOR: 1.25, iridescenceThicknessRange: [120, 420],
      clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 0.45,
    }),
  ));

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

  // screen
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(1.62, 1.3, 0.05, 3, 0.02), shellWhite);
  bezel.position.set(0, 0.62, 0.02);
  group.add(bezel);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.36, 1.04),
    new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: vertex, fragmentShader: screenFragment }),
  );
  screen.position.set(0, 0.62, 0.05);
  group.add(screen);

  // d-pad on a round seat
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 40), shellWhite);
  seat.rotation.x = Math.PI / 2;
  seat.position.set(-0.52, -0.62, 0.17);
  group.add(seat);
  for (const rot of [0, Math.PI / 2]) {
    const bar = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.16, 0.08, 2, 0.03), keyWhite);
    bar.rotation.z = rot;
    bar.position.set(-0.52, -0.62, 0.2);
    group.add(bar);
  }

  // four face buttons
  for (const [x, y] of [[0.52, -0.44], [0.7, -0.62], [0.52, -0.8], [0.34, -0.62]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 28), keyWhite);
    b.rotation.x = Math.PI / 2;
    b.position.set(x, y, 0.2);
    group.add(b);
  }

  // start / select
  for (const x of [-0.16, 0.16]) {
    const s = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.07, 0.05, 2, 0.025), chipMats[1]);
    s.position.set(x, -1.18, 0.19);
    s.rotation.z = -0.4;
    group.add(s);
  }

  return { group, screen };
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
