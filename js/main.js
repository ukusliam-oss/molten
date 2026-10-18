import { hero } from './hero.js';

const tick = hero(document.querySelector('.hero'));

// canvas text needs the web fonts; redraw once they arrive
Promise.all([
  document.fonts.load('900 100px "Inter Tight"'),
  document.fonts.load('600 13px "Inter Tight"'),
  document.fonts.load('400 100px "Mr Dafoe"'),
]).then(tick.refresh).catch(() => {});

let last = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  tick(now / 1000, dt);
  requestAnimationFrame(frame);
});
