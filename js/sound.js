// Tiny square-wave blips, Game Boy style. The context is created on the first press,
// which is always a user gesture, so browsers allow it.

let ctx = null;

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function blip(freq, dur, { type = 'square', gain = 0.03, at = 0, slide = 1 } = {}) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const sfx = {
  press: () => blip(1400, 0.03, { gain: 0.02 }),
  move: () => blip(880, 0.05),
  slot: () => {
    blip(220, 0.09, { type: 'triangle', gain: 0.09, slide: 0.5 });
    blip(660, 0.06, { at: 0.2 });
    blip(990, 0.09, { at: 0.26 });
  },
  open: () => [523, 659, 784, 1047].forEach((f, i) => blip(f, 0.08, { at: i * 0.06 })),
  back: () => blip(520, 0.1, { slide: 0.6 }),
  nope: () => { blip(200, 0.08, { gain: 0.04 }); blip(150, 0.12, { gain: 0.04, at: 0.09 }); },
};
