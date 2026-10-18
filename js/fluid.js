import * as THREE from 'three';

// A small stable-fluids solver (after Pavel Dobryakov's WebGL fluid, MIT), set up the way
// buttermax.net runs its "mousefluid" layer: 128² velocity, 512² dye, no vorticity,
// 10 pressure iterations, velocity ×0.985 and dye ×0.95 per 60 Hz step, line-segment splats
// whose radius follows the pointer's speed. The page reads the dye: ≥ 0.5 is ink.
// One addition of ours: a weak gravity on dense dye, so ink sags and drips (it is Molten).

const SIM = 128, DYE = 512;
const CONFIG = { velocity: 0.985, dye: 0.95, pressure: 0.8, iterations: 10, gravity: 26 };

const baseVertex = /* glsl */`
uniform vec2 texelSize;
varying vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = uv;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const SHADERS = {
  // a stroke from the previous pointer position to this one, cubic falloff, added on top
  splat: `
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform vec2 prevPoint;
uniform float radius;
varying vec2 vUv;
float segment(vec2 uv, vec2 a, vec2 b) {
  vec2 pa = uv - a, ba = b - a;
  pa.x *= aspectRatio; ba.x *= aspectRatio;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
  return length(pa - ba * h);
}
float cubicOut(float t) { float f = t - 1.0; return f * f * f + 1.0; }
void main() {
  vec3 splat = (1.0 - cubicOut(clamp(segment(vUv, prevPoint, point) / radius, 0.0, 1.0))) * color;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
}`,
  divergence: `
uniform sampler2D uVelocity;
varying vec2 vUv, vL, vR, vT, vB;
void main() {
  float L = texture2D(uVelocity, vL).x, R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y, B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) L = -C.x;
  if (vR.x > 1.0) R = -C.x;
  if (vT.y > 1.0) T = -C.y;
  if (vB.y < 0.0) B = -C.y;
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  clear: `
uniform sampler2D uTexture;
uniform float value;
varying vec2 vUv;
void main() { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  pressure: `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
varying vec2 vUv, vL, vR, vT, vB;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
varying vec2 vUv, vL, vR, vT, vB;
void main() {
  float L = texture2D(uPressure, vL).x, R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x, B = texture2D(uPressure, vB).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(v, 0.0, 1.0);
}`,
  // semi-Lagrangian advection; for velocity it also adds gravity where the dye is dense
  advect: `
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform sampler2D uDye;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
uniform float gravity;
varying vec2 vUv;
void main() {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
  vec4 v = dissipation * texture2D(uSource, coord);
  v.y -= gravity * dt * smoothstep(0.4, 2.0, texture2D(uDye, vUv).r);
  gl_FragColor = vec4(v.xyz, 1.0);
}`,
};

export function makeFluid(renderer) {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);

  const target = () => new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
  });
  const pair = () => {
    let a = target(), b = target();
    return {
      get read() { return a; }, get write() { return b; },
      swap() { [a, b] = [b, a]; },
      setSize(w, h) { a.setSize(w, h); b.setSize(w, h); },
    };
  };
  const velocity = pair(), dye = pair(), pressure = pair();
  const divergence = target();
  const simTexel = new THREE.Vector2(), dyeTexel = new THREE.Vector2();

  const mat = (name, uniforms, texel) => new THREE.ShaderMaterial({
    vertexShader: baseVertex, fragmentShader: SHADERS[name],
    uniforms: { texelSize: { value: texel }, ...uniforms },
    depthTest: false, depthWrite: false,
  });
  const m = {
    splat: mat('splat', { uTarget: { value: null }, aspectRatio: { value: 1 }, color: { value: new THREE.Vector3() }, point: { value: new THREE.Vector2() }, prevPoint: { value: new THREE.Vector2() }, radius: { value: 0.1 } }, simTexel),
    divergence: mat('divergence', { uVelocity: { value: null } }, simTexel),
    clear: mat('clear', { uTexture: { value: null }, value: { value: CONFIG.pressure } }, simTexel),
    pressure: mat('pressure', { uPressure: { value: null }, uDivergence: { value: null } }, simTexel),
    gradient: mat('gradient', { uPressure: { value: null }, uVelocity: { value: null } }, simTexel),
    advectVel: mat('advect', { uVelocity: { value: null }, uSource: { value: null }, uDye: { value: null }, dt: { value: 0 }, dissipation: { value: 1 }, gravity: { value: 0 } }, simTexel),
    advectDye: mat('advect', { uVelocity: { value: null }, uSource: { value: null }, uDye: { value: null }, dt: { value: 0 }, dissipation: { value: 1 }, gravity: { value: 0 } }, simTexel),
  };

  function run(material, out) {
    quad.material = material;
    renderer.setRenderTarget(out);
    renderer.render(scene, camera);
  }

  let aspect = 1;
  function resize(w, h) {
    aspect = w / h;
    const sw = Math.round(SIM * Math.max(1, aspect)), sh = Math.round(SIM / Math.min(1, aspect));
    const dh = Math.min(DYE, Math.round(h * 0.75)), dw = Math.min(1024, Math.round(dh * aspect));
    velocity.setSize(sw, sh); pressure.setSize(sw, sh); divergence.setSize(sw, sh);
    dye.setSize(dw, dh);
    simTexel.set(1 / sw, 1 / sh);
    dyeTexel.set(1 / dw, 1 / dh);
    m.splat.uniforms.aspectRatio.value = aspect;
  }

  // x, y and the previous point in 0..1 page coordinates (y up); force in sim cells per second
  function splat(x, y, px, py, fx, fy, radius, amount) {
    const u = m.splat.uniforms;
    u.point.value.set(x, y);
    u.prevPoint.value.set(px, py);
    u.radius.value = radius;
    u.uTarget.value = velocity.read.texture;
    u.color.value.set(fx, fy, 0);
    run(m.splat, velocity.write); velocity.swap();
    if (amount > 0) {
      u.uTarget.value = dye.read.texture;
      u.color.value.set(amount, amount, amount);
      run(m.splat, dye.write); dye.swap();
    }
  }

  function step(dt) {
    const hz = dt * 60;   // the constants are per 60 Hz frame
    m.divergence.uniforms.uVelocity.value = velocity.read.texture;
    run(m.divergence, divergence);
    m.clear.uniforms.uTexture.value = pressure.read.texture;
    run(m.clear, pressure.write); pressure.swap();
    m.pressure.uniforms.uDivergence.value = divergence.texture;
    for (let i = 0; i < CONFIG.iterations; i++) {
      m.pressure.uniforms.uPressure.value = pressure.read.texture;
      run(m.pressure, pressure.write); pressure.swap();
    }
    m.gradient.uniforms.uPressure.value = pressure.read.texture;
    m.gradient.uniforms.uVelocity.value = velocity.read.texture;
    run(m.gradient, velocity.write); velocity.swap();

    const av = m.advectVel.uniforms;
    av.uVelocity.value = velocity.read.texture; av.uSource.value = velocity.read.texture; av.uDye.value = dye.read.texture;
    av.dt.value = dt; av.dissipation.value = Math.pow(CONFIG.velocity, hz); av.gravity.value = CONFIG.gravity;
    run(m.advectVel, velocity.write); velocity.swap();

    const ad = m.advectDye.uniforms;
    ad.uVelocity.value = velocity.read.texture; ad.uSource.value = dye.read.texture; ad.uDye.value = dye.read.texture;
    ad.dt.value = dt; ad.dissipation.value = Math.pow(CONFIG.dye, hz); ad.gravity.value = 0;
    run(m.advectDye, dye.write); dye.swap();
    renderer.setRenderTarget(null);
  }

  return {
    resize, splat, step,
    get dye() { return dye.read.texture; },
    get velocity() { return velocity.read.texture; },
  };
}
