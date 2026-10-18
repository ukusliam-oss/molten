import * as THREE from 'three';

// The console's display: a 160×144 canvas (the Game Boy's resolution) drawn in a pixel font.
// Transparent pixels let the iridescent idle pattern show through. A cartridge's real screenshots
// are dithered into four tones of its own colour and shown as a slideshow.

const SW = 160, SH = 144;
const AW = 160, AH = 104, AY = 14;          // where the art sits: between the header and the footer
const INK = '#0e0e0e', PAPER = '#ffb41f', CREAM = '#fff1dc', LINE = '#b8ad9b';
const SLIDE = 3.2;                           // seconds per screenshot
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// ---- screenshots → four-tone pixel art, made once per image
const art = new Map();       // `${id}:${i}` → 160×104 art for the screen
const images = new Map();    // `${id}:${i}` → the loaded screenshot
const palettes = new Map();  // id → the cartridge's four tones
const labels = new Map();    // label art, by size
function dither(img, [x, y, w, h], pal, AW, AH) {
  const cv = document.createElement('canvas');
  cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, x, y, w, h, 0, 0, AW, AH);
  const d = g.getImageData(0, 0, AW, AH), p = d.data;
  const lum = new Float32Array(AW * AH);
  let lo = 1, hi = 0;
  for (let i = 0; i < lum.length; i++) {
    const l = (0.2126 * p[i * 4] + 0.7152 * p[i * 4 + 1] + 0.0722 * p[i * 4 + 2]) / 255;
    lum[i] = l; lo = Math.min(lo, l); hi = Math.max(hi, l);
  }
  for (let i = 0; i < lum.length; i++) {
    const t = (lum[i] - lo) / Math.max(1e-3, hi - lo);
    const b = (BAYER[(i % AW & 3) + ((Math.floor(i / AW) & 3) << 2)] + 0.5) / 16 - 0.5;
    const c = pal[Math.max(0, Math.min(3, Math.round(t * 3 + b)))];
    p[i * 4] = c[0]; p[i * 4 + 1] = c[1]; p[i * 4 + 2] = c[2]; p[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return cv;
}
export function prepare(carts) {
  for (const cart of carts) {
    const pal = [rgb(cart.screen), rgb(cart.color), mix(rgb(cart.color), rgb(CREAM), 0.55), rgb(CREAM)];
    palettes.set(cart.id, pal);
    cart.shots.forEach((shot, i) => {
      const key = `${cart.id}:${i}`;
      if (art.has(key)) return;
      art.set(key, null);
      const img = new Image();
      img.onload = () => { images.set(key, img); art.set(key, dither(img, shot.crop, pal, AW, AH)); };
      img.src = shot.src;
    });
  }
}

// the first screenshot, dithered at another size for the cartridge's label (null until loaded)
export function labelArt(cart, w, h) {
  const key = `${cart.id}:${w}x${h}`;
  if (labels.has(key)) return labels.get(key);
  const img = images.get(`${cart.id}:0`);
  if (!img) return null;
  const [x, y, cw, ch] = cart.shots[0].crop, a = w / h;
  let nw = cw, nh = cw / a;
  if (nh > ch) { nh = ch; nw = ch * a; }
  const cv = dither(img, [x + (cw - nw) / 2, y + (ch - nh) / 2, nw, nh], palettes.get(cart.id), w, h);
  labels.set(key, cv);
  return cv;
}

export function makeScreen() {
  const canvas = document.createElement('canvas');
  canvas.width = SW; canvas.height = SH;
  const c = canvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;

  const box = (x, y, w, h, color) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
  function text(str, x, y, size, color, align = 'left') {
    c.font = `${size}px "Press Start 2P", monospace`;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = 'top';
    c.fillText(str, Math.round(x), Math.round(y));
  }
  // pixel triangle, pointing right (dir 1) or left (dir -1)
  function arrow(x, y, dir, color) {
    c.fillStyle = color;
    for (let i = 0; i < 4; i++) c.fillRect(x + i * dir, y + i, 1, 7 - i * 2);
  }
  function footer(label, blink, arrows = true) {
    box(0, AY + AH, SW, SH - AY - AH, INK);
    if (arrows && blink) { arrow(6, 128, -1, CREAM); arrow(153, 128, 1, CREAM); }
    text(label, SW / 2, 128, 8, CREAM, 'center');
  }

  function home(blink) {
    box(0, 0, SW, 13, INK);
    text('MOLTEN', SW / 2, 3, 8, PAPER, 'center');
    if (!blink) return;
    box(28, 116, 104, 17, INK);
    arrow(36, 121, -1, CREAM);
    text('PRESS', SW / 2, 121, 8, CREAM, 'center');
    arrow(123, 121, 1, CREAM);
  }

  // drawn previews, for a cartridge with no screenshots it can show
  function preview(id, t) {
    if (id === 'folio') {
      box(38, 56, 40, 48, CREAM); box(82, 56, 40, 48, CREAM); box(78, 56, 4, 48, '#c9bfae');
      for (let r = 0; r < 6; r++) {
        box(43, 62 + r * 7, 30 - (r % 3) * 6, 2, LINE);
        box(87, 62 + r * 7, 30 - ((r + 1) % 3) * 6, 2, LINE);
      }
      const w = Math.round(Math.cos((t * 0.6 % 1) * Math.PI) * 40);   // a page turning over the spine
      box(w > 0 ? 82 : 78 + w, 54, Math.abs(w), 52, '#fff8ec');
    } else if (id === 'term') {
      const cols = ['#e2483d', '#ffb41f', '#3156d3', '#1f9d6b', '#9a6bd8', '#f08bb0'];
      for (let r = 0; r < 6; r++) for (let k = 0; k < 5; k++) box(28 + k * 21, 56 + r * 8, 19, 6, cols[(r * 5 + k * 3) % cols.length]);
      const now = Math.floor(t * 1.5) % 30, r = Math.floor(now / 5), k = now % 5;
      c.strokeStyle = '#fff'; c.lineWidth = 1;
      c.strokeRect(28 + k * 21 - 1.5, 56 + r * 8 - 1.5, 22, 9);
    } else {
      box(32, 50, 96, 58, CREAM);
      text('Q3', 36, 54, 8, '#1f9d6b');
      text('[4]', 124, 54, 8, '#1f9d6b', 'right');
      for (let r = 0; r < 5; r++) box(36, 66 + r * 7, 84 - (r * 13) % 40, 2, LINE);
      box(122, 65 + (Math.floor(t * 1.2) % 5) * 7, 3, 4, '#1f9d6b');
    }
  }

  function cart(s, cart, t, blink) {
    box(0, 0, SW, SH, cart.screen);
    box(0, 0, SW, AY, cart.color);
    text(cart.name.toUpperCase(), 4, 3, 8, '#ffffff');
    text(`${s.index + 1}/${s.carts.length}`, SW - 4, 3, 8, '#ffffff', 'right');
    const n = cart.shots.length;
    if (n) {
      const since = Math.max(0, t - s.slotAt), k = Math.floor(since / SLIDE) % n, f = (since / SLIDE) % 1;
      const cur = art.get(`${cart.id}:${k}`);
      if (cur) c.drawImage(cur, 0, AY); else preview(cart.id, t);
      const next = n > 1 && f > 0.9 && art.get(`${cart.id}:${(k + 1) % n}`);
      if (next) {   // wipe to the next screenshot
        const w = Math.round((f - 0.9) / 0.1 * SW);
        c.drawImage(next, 0, 0, w, AH, 0, AY, w, AH);
        box(w, AY, 2, AH, CREAM);
      }
    } else {
      text(cart.kind, SW / 2, 30, 8, cart.color, 'center');
      preview(cart.id, t);
    }
    footer('A VIEW  B BACK', blink);
  }

  function list(s) {
    box(0, 0, SW, SH, INK);
    text('SELECT', SW / 2, 10, 8, PAPER, 'center');
    s.carts.forEach((cart, i) => {
      const y = 34 + i * 18, on = i === s.cursor;
      if (on) { box(10, y - 4, 140, 16, PAPER); arrow(15, y, 1, INK); }
      text(cart.name.toUpperCase(), 26, y, 8, on ? INK : CREAM);
    });
    text('A SLOT  B BACK', SW / 2, 126, 8, CREAM, 'center');
  }

  function contact(blink) {
    box(0, 0, SW, SH, INK);
    text('CONTACT', SW / 2, 14, 8, PAPER, 'center');
    text('GITHUB', SW / 2, 46, 16, CREAM, 'center');
    text('@UKUSLIAM-OSS', SW / 2, 72, 8, PAPER, 'center');
    if (blink) text('A OPEN  B BACK', SW / 2, 120, 8, CREAM, 'center');
  }

  function flash() {
    box(0, 0, SW, SH, CREAM);
    for (let k = 0; k < 9; k++) box(0, Math.random() * SH, SW, 1 + Math.random() * 3, INK);
  }

  function toast(msg) {
    box(10, 58, 140, 26, INK);
    c.strokeStyle = CREAM; c.lineWidth = 1;
    c.strokeRect(12.5, 60.5, 135, 21);
    text(msg, SW / 2, 67, 8, PAPER, 'center');
  }

  function draw(s, t) {
    c.clearRect(0, 0, SW, SH);
    const blink = Math.floor(t * 2) % 2 === 0;
    if (t < s.flashUntil) flash();
    else if (s.mode === 'list') list(s);
    else if (s.mode === 'contact') contact(blink);
    else if (s.index >= 0) cart(s, s.carts[s.index], t, blink);
    else home(blink);
    if (s.toast && t < s.toastUntil) toast(s.toast);
    tex.needsUpdate = true;
  }

  return { tex, draw };
}
