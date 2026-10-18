import { hero } from './hero.js';
import { controller } from './console.js';
import { HOME } from './cartridges.js';

const h = hero(document.querySelector('.hero'), HOME);
controller(h);

// canvas text needs the web fonts; redraw once they arrive
Promise.all([
  document.fonts.load('900 100px "Inter Tight"'),
  document.fonts.load('600 13px "Inter Tight"'),
  document.fonts.load('400 100px "Mr Dafoe"'),
  document.fonts.load('8px "Press Start 2P"'),
]).then(h.refresh).catch(() => {});

let last = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  h.tick(now / 1000, dt);
  requestAnimationFrame(frame);
});
