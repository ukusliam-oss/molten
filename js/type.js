import { clamp } from './util.js';

// Paints one layer of the hero's type into a canvas the ink shader samples.
// The base layer is what you see on the yellow page; the hidden layer only shows inside the ink.
// Home's hidden layer repeats the base (the ink inverts the wordmark); a cartridge's hidden layer
// holds its facts, big enough that a blob uncovers about a word at a time.

const heavy = s => `900 ${s}px "Inter Tight", "Helvetica Neue", Arial, sans-serif`;
const brush = s => `400 ${s * 1.32}px "Mr Dafoe", "Snell Roundhand", cursive`;
const small = s => `600 ${s}px "Inter Tight", Arial, sans-serif`;

// the wordmark's largest size: on narrow screens it is held down so every title leaves room for the console
const cap = (W, H) => (W / H < 1.15 ? Math.min(W * 0.3, H * 0.4) : H * 0.4);

// the lowest any title's line of text can reach, in pixels — the console is placed under it on narrow screens
export function typeBottom(W, H) {
  const top = Math.max(76, H * 0.12), tiny = clamp(W * 0.0085, 10, 13);
  return top + cap(W, H) * 0.76 + tiny * 2.8;
}

export function paintType(canvas, content, W, H, hidden) {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#000';
  const spacing = v => { if ('letterSpacing' in c) c.letterSpacing = v + 'px'; };
  const pad = clamp(W * 0.04, 16, 56);
  const top = Math.max(76, H * 0.12);
  const tiny = clamp(W * 0.0085, 10, 13);

  if (hidden && content.facts) {
    const fs = clamp(W * 0.052, 24, 72);
    c.font = heavy(fs);
    spacing(-fs * 0.03);
    content.facts.forEach((fact, i) => {
      c.textAlign = i % 2 ? 'right' : 'left';
      c.fillText(fact, i % 2 ? W - pad : pad, top + fs * (1 + i * 1.25));
    });
    c.textAlign = 'left';
  } else {
    // wordmark: heavy grotesk + brush script, sized to the width like Buttermax
    const widths = s => {
      c.font = heavy(s); spacing(-s * 0.055);
      const a = c.measureText(content.heavy).width;
      c.font = brush(s); spacing(0);
      return [a, c.measureText(content.script).width];
    };
    let [a, b] = widths(100);
    const s = Math.min((W - pad * 2) / (a + b - 4) * 94, cap(W, H));   // the brush tail overshoots its measured width
    [a, b] = widths(s);
    const overlap = s * 0.04;
    const x0 = (W - (a + b - overlap)) / 2;
    const base = top + s * 0.76;
    c.font = heavy(s); spacing(-s * 0.055);
    c.fillText(content.heavy, x0, base);
    c.font = brush(s); spacing(0);
    c.fillText(content.script, x0 + a - overlap, base - s * 0.05);
    c.font = small(tiny); spacing(tiny * 0.05);
    c.fillText(content.line, x0 + s * 0.03, base + tiny * 2.4);
  }

  c.font = small(tiny);
  spacing(tiny * 0.05);
  c.fillText(content.left, pad, H - pad);
  c.textAlign = 'right';
  c.fillText(content.right, W - pad, H - pad);
  c.textAlign = 'left';
}
