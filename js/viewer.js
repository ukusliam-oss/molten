// The page A opens: the cartridge's real screens full size, its story and its facts.
// It spreads out of the console's screen as a circle of ink and closes back into it.

const OPEN_MS = 700;

export function makeViewer(onClose) {
  const el = document.querySelector('.viewer');
  const $ = s => el.querySelector(s);
  const media = $('.viewer__media'), img = $('.viewer__img'), cap = $('.viewer__cap'), count = $('.viewer__count');
  const kind = $('.viewer__kind'), title = $('.viewer__title'), story = $('.viewer__story');
  const facts = $('.viewer__facts'), updated = $('.viewer__updated'), link = $('.viewer__link');
  let cart = null, i = 0, timer = 0;

  function show() {
    const shots = cart.shots;
    media.hidden = !shots.length;
    if (!shots.length) return;
    const shot = shots[i];
    img.src = shot.src;
    img.alt = shot.caption;
    img.classList.toggle('is-tall', shot.crop[2] < 800);
    cap.textContent = shot.caption;
    count.textContent = `${i + 1} / ${shots.length}`;
    el.querySelectorAll('[data-step]').forEach(b => { b.hidden = shots.length < 2; });
  }

  function open(c, from, ago) {
    cart = c; i = 0;
    kind.textContent = `${c.kind}${c.url ? ' · LIVE' : ''}`;
    title.replaceChildren(
      Object.assign(document.createElement('span'), { className: 'h', textContent: c.heavy }),
      Object.assign(document.createElement('span'), { className: 's', textContent: c.script }),
    );
    story.textContent = c.story;
    facts.replaceChildren(...c.facts.map(f => Object.assign(document.createElement('li'), { textContent: f })));
    updated.textContent = c.updated ? `Last pushed to GitHub ${ago(c.updated).toLowerCase()}.` : '';
    link.hidden = !c.url;
    if (c.url) link.href = c.url;
    show();
    clearTimeout(timer);
    el.style.setProperty('--x', `${from.x}px`);
    el.style.setProperty('--y', `${from.y}px`);
    el.hidden = false;
    el.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    $('.viewer__close').focus({ preventScroll: true });
  }

  function close(from) {
    if (from) { el.style.setProperty('--x', `${from.x}px`); el.style.setProperty('--y', `${from.y}px`); }
    el.classList.remove('is-open');
    timer = setTimeout(() => { el.hidden = true; }, OPEN_MS);
  }

  function step(d) {
    if (!cart || cart.shots.length < 2) return;
    i = (i + d + cart.shots.length) % cart.shots.length;
    show();
  }

  el.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => step(Number(b.dataset.step))));
  $('.viewer__close').addEventListener('click', () => onClose());

  return { open, close, step, OPEN_MS };
}
