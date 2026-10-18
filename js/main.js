import { hero } from './hero.js';
import { controller } from './console.js';
import { HOME } from './cartridges.js';

const section = document.querySelector('.hero');

// canvas text needs the web fonts; the plain-HTML wordmark stays up until they are in and a frame is drawn
// (never wait more than 2.5 s: a stalled font request must not keep the console hidden)
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('900 100px "Inter Tight"'),
    document.fonts.load('600 13px "Inter Tight"'),
    document.fonts.load('400 100px "Mr Dafoe"'),
    document.fonts.load('8px "Press Start 2P"'),
  ]),
  new Promise(r => setTimeout(r, 2500)),
]).catch(() => {});

let h;
try {
  h = hero(section, HOME);
  controller(h);
} catch (err) {
  // no WebGL (or it failed to start): keep the HTML wordmark and say why
  console.error(err);
  section.classList.add('is-broken');
  section.querySelector('.hero__status').textContent = 'This console needs WebGL — try another browser.';
}

if (h) {
  const status = section.querySelector('.hero__status');
  h.canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    section.classList.remove('is-live');
    section.classList.add('is-broken');
    status.textContent = 'The console lost its screen — tap to restart.';
    section.querySelector('.hero__fallback').addEventListener('click', () => location.reload(), { once: true });
  });
  h.canvas.addEventListener('webglcontextrestored', () => location.reload());

  let firstFrame;
  const drawn = new Promise(r => { firstFrame = r; });
  Promise.all([fontsReady, drawn]).then(() => {
    h.refresh();
    requestAnimationFrame(() => section.classList.add('is-live'));
  });

  let last = performance.now();
  requestAnimationFrame(function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;
    h.tick(now / 1000, dt);
    firstFrame();
    requestAnimationFrame(frame);
  });
}
