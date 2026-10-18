import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointer, watch, makeRenderer, studioLight, clamp, rng } from './util.js';

// Lusion-style pile: six-way pipe crosses packed into the card, tumbling slowly.
// Move through them and they scatter, then settle back. Physics is a few springs:
// pull to the centre, push apart on overlap, shove away from the cursor.

const MAX = 72;

function tint(g, v) {
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(v), 3));
  return g;
}

// turn a tube inside out so its inner wall is the visible side
function inward(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}

function crossGeometry() {
  const L = 1, R = 0.3, r = 0.13, depth = 0.32;
  const arm = [tint(new THREE.CylinderGeometry(R, R, 2 * L, 40, 1, true), 1)];
  for (const s of [1, -1]) {
    const cap = new THREE.RingGeometry(r, R, 40);
    cap.rotateX(-s * Math.PI / 2).translate(0, s * L, 0);
    const bore = inward(new THREE.CylinderGeometry(r, r, depth, 24, 1, true));
    bore.translate(0, s * (L - depth / 2), 0);
    const floor = new THREE.CircleGeometry(r, 24);
    floor.rotateX(-s * Math.PI / 2).translate(0, s * (L - depth), 0);
    arm.push(tint(cap, 1), tint(bore, 0.22), tint(floor, 0.05));
  }
  const y = mergeGeometries(arm);
  return mergeGeometries([y, y.clone().rotateZ(Math.PI / 2), y.clone().rotateX(Math.PI / 2)]);
}

export function studio(stage) {
  const canvas = stage.querySelector('canvas');
  const seen = watch(stage);
  const renderer = makeRenderer(canvas, { maxDpr: 1.75 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#15161b');
  scene.environment = studioLight(renderer);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 120);
  camera.position.z = 20;
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(6, 9, 10);
  const rim = new THREE.DirectionalLight('#8fa0ff', 1.2);
  rim.position.set(-8, -4, -6);
  scene.add(key, rim);

  const mesh = new THREE.InstancedMesh(
    crossGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0, envMapIntensity: 0.7 }),
    MAX,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const palette = ['#ebe7e0', '#ebe7e0', '#ebe7e0', '#e2ded6', '#1f2bff', '#1f2bff', '#141418'].map(c => new THREE.Color(c));
  const rand = rng(3);
  const bodies = [];
  for (let i = 0; i < MAX; i++) {
    mesh.setColorAt(i, palette[Math.floor(rand() * palette.length)]);
    const a = rand() * Math.PI * 2, d = 9 + rand() * 6;   // start just outside the card and fall in
    const spin = () => (rand() - 0.5) * 0.6;
    bodies.push({
      p: new THREE.Vector3(Math.cos(a) * d, Math.sin(a) * d, (rand() - 0.5) * 6),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)),
      w: new THREE.Vector3(spin(), spin(), spin()),
      spin: new THREE.Vector3(spin(), spin(), spin()),
      s: 0.85 + rand() * 0.35,
    });
  }

  let count = MAX, kx = 0.3;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    count = Math.round(clamp(w * h / 11000, 26, MAX));
    mesh.count = count;
    // pull the camera back until the pile slightly overflows the card
    const visH = Math.sqrt(count * 4.5 / camera.aspect) * 0.62;
    camera.position.z = visH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.updateProjectionMatrix();
    kx = 1.1 / (camera.aspect * camera.aspect);   // flatten the pile to the card's shape
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  const mouse = new THREE.Vector3(), mouseVel = new THREE.Vector3();
  let mouseIn = false;
  const tmp = new THREE.Vector3(), axis = new THREE.Vector3(), dq = new THREE.Quaternion();
  const m4 = new THREE.Matrix4(), scl = new THREE.Vector3();

  return function tick(t, dt) {
    if (!seen.on) return;
    const rect = stage.getBoundingClientRect();
    const inside = pointer.x > rect.left && pointer.x < rect.right && pointer.y > rect.top && pointer.y < rect.bottom;
    if (inside) {
      ndc.set((pointer.x - rect.left) / rect.width * 2 - 1, -((pointer.y - rect.top) / rect.height * 2 - 1));
      ray.setFromCamera(ndc, camera);
      ray.ray.intersectPlane(plane, hit);
      mouseVel.subVectors(hit, mouseIn ? mouse : hit).divideScalar(Math.max(dt, 1e-3));
      mouse.copy(hit);
    } else {
      mouseVel.set(0, 0, 0);
    }
    mouseIn = inside;

    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      b.v.x -= b.p.x * kx * dt;
      b.v.y -= b.p.y * 1.1 * dt;
      b.v.z -= b.p.z * 2.5 * dt;
      b.w.lerp(b.spin, 1 - Math.exp(-0.6 * dt));
    }

    // overlap → push apart, and a glancing hit sets both tumbling
    for (let i = 0; i < count; i++) {
      const A = bodies[i];
      for (let j = i + 1; j < count; j++) {
        const B = bodies[j];
        tmp.subVectors(B.p, A.p);
        const min = (A.s + B.s) * 0.95, d2 = tmp.lengthSq();
        if (d2 >= min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (min - d) * 14 * dt;
        tmp.multiplyScalar(1 / d);
        A.v.addScaledVector(tmp, -push);
        B.v.addScaledVector(tmp, push);
        axis.set(tmp.y, -tmp.x, tmp.z * 0.5);
        A.w.addScaledVector(axis, push * 3);
        B.w.addScaledVector(axis, -push * 3);
      }
    }

    if (inside) {
      for (let i = 0; i < count; i++) {
        const b = bodies[i];
        tmp.subVectors(b.p, mouse);
        tmp.z *= 0.5;
        const d = tmp.length(), reach = 3.2;
        if (d > reach) continue;
        const f = 1 - d / reach;
        b.v.addScaledVector(tmp.normalize(), f * 60 * dt);
        b.v.lerp(tmp.copy(mouseVel).add(b.v), f * Math.min(1, 6 * dt));
        b.w.x -= mouseVel.y * f * dt * 1.5;
        b.w.y += mouseVel.x * f * dt * 1.5;
      }
    }

    const vDamp = Math.exp(-1.8 * dt), wDamp = Math.exp(-0.8 * dt);
    for (let i = 0; i < count; i++) {
      const b = bodies[i];
      b.v.multiplyScalar(vDamp);
      b.w.multiplyScalar(wDamp);
      b.p.addScaledVector(b.v, dt);
      const ang = b.w.length();
      if (ang > 1e-5) b.q.premultiply(dq.setFromAxisAngle(axis.copy(b.w).divideScalar(ang), ang * dt));
      mesh.setMatrixAt(i, m4.compose(b.p, b.q, scl.setScalar(b.s)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  };
}
