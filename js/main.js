import { hero } from './hero.js';
import { studio } from './crosses.js';
import { soda } from './soda.js';

// Each scene returns a tick(t, dt); one shared frame loop drives them all.
// A scene that fails (no WebGL, old browser) is skipped so the rest still work.
function safe(make, el) {
  try { return make(el); } catch (err) { console.error(err); return () => {}; }
}

const ticks = [
  safe(hero, document.querySelector('.hero')),
  safe(studio, document.querySelector('.studio__stage')),
  safe(soda, document.querySelector('.soda')),
];

// canvas text needs the web fonts; redraw once they arrive
Promise.all([
  document.fonts.load('900 100px "Inter Tight"'),
  document.fonts.load('600 64px "Inter Tight"'),
  document.fonts.load('400 100px "Mr Dafoe"'),
]).then(() => ticks.forEach(t => t.refresh?.())).catch(() => {});

const nav = document.querySelector('.nav');
const contact = document.querySelector('#contact');
function onScroll() {
  nav.classList.toggle('is-scrolled', scrollY > innerHeight * 0.6);
  nav.classList.toggle('is-light', contact.getBoundingClientRect().top < 40);
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

let last = performance.now();
requestAnimationFrame(function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  for (const tick of ticks) tick(now / 1000, dt);
  requestAnimationFrame(frame);
});
