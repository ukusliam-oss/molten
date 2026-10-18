import * as THREE from 'three';

// The console's display: a 160×144 canvas (the Game Boy's resolution) drawn in a pixel font.
// Transparent pixels let the iridescent idle pattern show through.

const SW = 160, SH = 144;
const INK = '#0e0e0e', PAPER = '#ffb41f', CREAM = '#fff1dc', LINE = '#b8ad9b';

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

  function home(blink) {
    box(0, 0, SW, 13, INK);
    text('MOLTEN', SW / 2, 3, 8, PAPER, 'center');
    if (!blink) return;
    box(28, 116, 104, 17, INK);
    arrow(36, 121, -1, CREAM);
    text('PRESS', SW / 2, 121, 8, CREAM, 'center');
    arrow(123, 121, 1, CREAM);
  }

  // placeholder previews until each cartridge gets its real recording
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
      box(32, 54, 96, 56, CREAM);
      text('Q3', 36, 58, 8, '#1f9d6b');
      for (let r = 0; r < 5; r++) box(36, 70 + r * 7, 84 - (r * 13) % 40, 2, LINE);
      box(122, 69 + (Math.floor(t * 1.2) % 5) * 7, 3, 4, '#1f9d6b');
    }
  }

  function cart(s, cart, t, blink) {
    box(0, 0, SW, SH, cart.screen);
    text(`${s.index + 1}/${s.carts.length}`, SW - 4, 4, 8, cart.color, 'right');
    const name = cart.name.toUpperCase();
    text(name, SW / 2, 18, name.length * 16 <= 152 ? 16 : 8, '#ffffff', 'center');
    text(cart.kind, SW / 2, 40, 8, cart.color, 'center');
    preview(cart.id, t);
    if (blink) { arrow(6, 124, -1, CREAM); arrow(153, 124, 1, CREAM); }
    text(cart.url ? 'A OPEN B BACK' : 'B BACK', SW / 2, 126, 8, CREAM, 'center');
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
    else if (s.mode === 'cart') cart(s, s.carts[s.index], t, blink);
    else home(blink);
    if (s.toast && t < s.toastUntil) toast(s.toast);
    tex.needsUpdate = true;
  }

  return { tex, draw };
}
