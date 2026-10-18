import { CARTRIDGES, HOME, ABOUT, CONTACT, GITHUB } from './cartridges.js';
import { prepare } from './screen.js';
import { makeViewer } from './viewer.js';
import { sfx } from './sound.js';

// Turns key presses, taps and drags on the handheld into what the console does.
// Modes: home (no cartridge) · cart (one slotted) · list (SELECT menu on the screen)
// · view (the cartridge's page, opened with A) · about (console turned over) · contact.

const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  z: 'a', Z: 'a', ' ': 'a', x: 'b', X: 'b', Escape: 'b', Backspace: 'b',
  Enter: 'start', s: 'select', S: 'select',   // not Shift: Shift+Tab would open the list
};
// face buttons X and Y double as SELECT and START; tapping the screen is A
const ACTION = { x: 'select', y: 'start', screen: 'a' };
const DEMO_EVERY = 5000;
const DRAG_TURN = 0.012;        // radians per pixel dragged
const DRAG_MIN = 6;             // pixels before a press on the shell counts as a drag

const pad2 = v => String(v).padStart(2, '0');

export function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} MIN AGO`;
  if (s < 86400) return `${Math.round(s / 3600)} H AGO`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'YESTERDAY' : `${d} DAYS AGO`;
}

// last push to a public repo, once per visit; a failure just leaves the line out
async function lastPush(repo) {
  const key = `molten.push.${repo}`;
  try { const v = sessionStorage.getItem(key); if (v) return v; } catch { /* storage blocked */ }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`);
    if (!r.ok) return null;
    const date = (await r.json())[0]?.commit?.committer?.date || null;
    if (date) try { sessionStorage.setItem(key, date); } catch { /* storage blocked */ }
    return date;
  } catch { return null; }
}

function contentFor(cart, i) {
  return {
    heavy: cart.heavy, script: cart.script, line: cart.line, facts: cart.facts,
    left: `CART ${pad2(i + 1)} / ${pad2(CARTRIDGES.length)} · ${cart.kind}${cart.updated ? ` · UPDATED ${ago(cart.updated)}` : ''}`,
    right: 'STIR TO READ · A TO VIEW',
  };
}

export function controller(hero) {
  const s = hero.state;
  s.carts = CARTRIDGES;
  const n = CARTRIDGES.length;
  const now = () => performance.now() / 1000;
  const toast = (msg, d = 1.2) => { s.toast = msg; s.toastUntil = now() + d; };
  let demo = null;

  setTimeout(() => prepare(CARTRIDGES), 600);
  for (const cart of CARTRIDGES) if (cart.repo) lastPush(cart.repo).then(d => { if (d) cart.updated = d; });

  const viewer = makeViewer(() => press('b', null));
  const current = () => (s.index >= 0 ? contentFor(CARTRIDGES[s.index], s.index) : HOME);
  const settleMode = () => { s.mode = s.index >= 0 ? 'cart' : 'home'; };
  const openTab = url => window.open(url, '_blank', 'noopener');

  function slot(i) {
    s.index = (i + n) % n;
    s.mode = 'cart';
    s.flashUntil = now() + 0.3;
    s.slotAt = now();
    hero.flipTo(false);
    hero.show(contentFor(CARTRIDGES[s.index], s.index));
    hero.insert(CARTRIDGES[s.index]);   // it clicks home with its own splash of ink
    sfx.slot();
  }

  function eject() {
    s.mode = 'home';
    s.index = -1;
    hero.show(HOME);
    hero.eject();
    sfx.back();
  }

  function view() {
    s.mode = 'view';
    stopDemo();
    viewer.open(CARTRIDGES[s.index], hero.screenPoint(), ago);
    sfx.open();
    setTimeout(() => { if (s.mode === 'view') s.paused = true; }, viewer.OPEN_MS);   // nothing to draw behind it
  }

  function closeView() {
    s.paused = false;
    settleMode();
    viewer.close(hero.screenPoint());
    sfx.back();
  }

  function about() {
    s.mode = 'about';
    hero.flipTo(true);
    hero.show(ABOUT);
    sfx.move();
  }

  function contact() {
    s.mode = 'contact';
    hero.flipTo(false);
    hero.show(CONTACT);
    sfx.move();
  }

  // back to the front, to whatever was there before
  function front() {
    hero.flipTo(false);
    settleMode();
    hero.show(current());
    sfx.back();
  }

  const stopDemo = () => { clearInterval(demo); demo = null; };

  function act(name) {
    if (s.mode === 'view') {
      if (name === 'left' || name === 'right') viewer.step(name === 'right' ? 1 : -1);
      else if (name === 'a' && CARTRIDGES[s.index].url) openTab(CARTRIDGES[s.index].url);
      else if (name === 'b' || name === 'select') closeView();
      return;
    }
    if (s.mode === 'about' || s.mode === 'contact') {
      if (name === 'a') { sfx.open(); openTab(GITHUB); return; }
      if (name === 'b' || name === 'select') { front(); return; }
      if (name !== 'left' && name !== 'right') return;
      settleMode();               // a d-pad press goes straight on to the cartridges
    }
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
        else view();
        break;
      case 'b':
        if (s.mode === 'list') { settleMode(); sfx.back(); }
        else if (s.mode === 'cart') eject();
        break;
      case 'select':
        if (s.mode === 'list') { settleMode(); sfx.back(); }
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
    if (button) hero.press(button);
    sfx.press();
    act(name);
  }

  addEventListener('keydown', e => {
    const k = KEYS[e.key];
    if (!k || e.metaKey || e.ctrlKey || e.altKey) return;
    // Enter or Space on a focused pill or button belongs to that control, not the console
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('a, button')) return;
    if (e.repeat && !['left', 'right', 'up', 'down'].includes(k)) return;
    e.preventDefault();
    press(k);
  });

  // pointer: press a button, pull the cartridge, or grab the shell and turn the console over
  const canvas = hero.canvas;
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    if (s.mode === 'view') return;
    const hit = hero.pick(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    if (hit === 'shell') {
      drag = { x: e.clientX, moved: false };
      hero.dragStart();
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (hit === 'cart') { if (s.mode === 'cart') press('b', null); return; }
    press(ACTION[hit] || hit, hit);
  });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > DRAG_MIN) drag.moved = true;
      hero.dragTo(drag.moved ? dx * DRAG_TURN : 0);
      canvas.style.cursor = 'grabbing';
      return;
    }
    const hit = hero.pick(e.clientX, e.clientY);
    canvas.style.cursor = hit === 'shell' ? 'grab' : hit ? 'pointer' : '';
    hero.hoverCart(hit === 'cart' && s.mode === 'cart');   // a seated cartridge lifts to show its label
  }, { passive: true });
  canvas.addEventListener('pointerleave', () => hero.hoverCart(false));
  function endDrag() {
    if (!drag) return;
    drag = null;
    const back = hero.dragEnd();
    if (back && s.mode !== 'about') about();
    else if (!back && s.mode === 'about') front();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // the nav pills drive the same console
  const pills = {
    about: () => (s.mode === 'about' ? front() : about()),
    contact: () => (s.mode === 'contact' ? front() : contact()),
    list: () => {
      if (s.mode === 'about' || s.mode === 'contact') { hero.flipTo(false); settleMode(); hero.show(current()); }
      if (s.mode !== 'list') press('select');
    },
  };
  document.querySelectorAll('[data-action]').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    if (s.mode === 'view') closeView();
    stopDemo();
    pills[a.dataset.action]?.();
  }));

  return { press };
}
