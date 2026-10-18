import { CARTRIDGES, HOME } from './cartridges.js';
import { sfx } from './sound.js';

// Turns key presses and taps on the handheld into what the console does.
// Modes: home (no cartridge), cart (one slotted), list (SELECT menu on the screen).

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  z: 'a', Z: 'a', ' ': 'a', x: 'b', X: 'b', Escape: 'b', Backspace: 'b',
  Enter: 'start', Shift: 'select',
};
// face buttons X and Y double as SELECT and START; tapping the screen is A
const ACTION = { x: 'select', y: 'start', screen: 'a' };
const DEMO_EVERY = 5000;

const pad2 = v => String(v).padStart(2, '0');

function contentFor(cart, i) {
  return {
    heavy: cart.heavy, script: cart.script, line: cart.line, facts: cart.facts,
    left: `CART ${pad2(i + 1)} / ${pad2(CARTRIDGES.length)} · ${cart.kind}`,
    right: cart.url ? 'STIR TO READ · A TO OPEN' : 'STIR TO READ',
  };
}

export function controller(hero) {
  const s = hero.state;
  s.carts = CARTRIDGES;
  const n = CARTRIDGES.length;
  const now = () => performance.now() / 1000;
  const toast = (msg, d = 1.2) => { s.toast = msg; s.toastUntil = now() + d; };
  let demo = null;

  function slot(i) {
    s.index = (i + n) % n;
    s.mode = 'cart';
    s.flashUntil = now() + 0.3;
    hero.show(contentFor(CARTRIDGES[s.index], s.index));
    hero.insert(CARTRIDGES[s.index]);
    hero.splash();
    sfx.slot();
  }

  function eject() {
    s.mode = 'home';
    s.index = -1;
    hero.show(HOME);
    hero.eject();
    sfx.back();
  }

  function open() {
    const cart = CARTRIDGES[s.index];
    if (cart.url) {
      sfx.open();
      toast('OPENING');
      window.open(cart.url, '_blank', 'noopener');
    } else {
      sfx.nope();
      toast('VIDEO SOON');
    }
  }

  const leaveList = () => { s.mode = s.index >= 0 ? 'cart' : 'home'; sfx.back(); };
  const stopDemo = () => { clearInterval(demo); demo = null; };

  function act(name) {
    switch (name) {
      case 'left':
      case 'right': {
        const d = name === 'right' ? 1 : -1;
        if (s.mode === 'list') { s.cursor = (s.cursor + d + n) % n; sfx.move(); }
        else slot(s.mode === 'home' ? (d > 0 ? 0 : n - 1) : s.index + d);
        break;
      }
      case 'up':
      case 'down':
        if (s.mode === 'list') { s.cursor = (s.cursor + (name === 'down' ? 1 : -1) + n) % n; sfx.move(); }
        break;
      case 'a':
        if (s.mode === 'home') slot(0);
        else if (s.mode === 'list') slot(s.cursor);
        else open();
        break;
      case 'b':
        if (s.mode === 'list') leaveList();
        else if (s.mode === 'cart') eject();
        break;
      case 'select':
        if (s.mode === 'list') leaveList();
        else { s.cursor = Math.max(0, s.index); s.mode = 'list'; sfx.move(); }
        break;
      case 'start':
        if (demo) { stopDemo(); toast('DEMO OFF', 0.8); break; }
        slot(s.mode === 'cart' ? s.index + 1 : 0);
        demo = setInterval(() => slot(s.index + 1), DEMO_EVERY);
        toast('DEMO', 0.8);
        break;
    }
  }

  function press(name, button = name) {
    if (demo && name !== 'start') stopDemo();
    hero.press(button);
    sfx.press();
    act(name);
  }

  addEventListener('keydown', e => {
    const k = KEYS[e.key];
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat && !['left', 'right', 'up', 'down'].includes(k)) return;
    e.preventDefault();
    press(k);
  });

  const canvas = hero.canvas;
  canvas.addEventListener('pointerdown', e => {
    const hit = hero.pick(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    press(ACTION[hit] || hit, hit);
  });
  canvas.addEventListener('pointermove', e => {
    canvas.style.cursor = hero.pick(e.clientX, e.clientY) ? 'pointer' : '';
  }, { passive: true });

  document.querySelector('[data-action="list"]')?.addEventListener('click', e => {
    e.preventDefault();
    press('select');
  });

  return { press };
}
