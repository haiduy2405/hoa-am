// Phím đàn vẽ bằng DOM: bấm được bằng chuột/cảm ứng, sáng theo nốt đang giữ.

const BLACK = new Set([1, 3, 6, 8, 10]);

export function rangeFor(count) {
  if (count >= 88) return [21, 108];
  if (count >= 76) return [28, 103];
  return [36, 96];
}

export function buildKeyboard(root, { lo, hi, onDown, onUp, label }) {
  root.textContent = '';
  const whites = [];
  for (let n = lo; n <= hi; n++) if (!BLACK.has(n % 12)) whites.push(n);
  const w = 100 / whites.length;
  const keys = new Map();
  const wrap = document.createElement('div');
  wrap.className = 'kb';
  wrap.style.setProperty('--wn', whites.length);

  let wi = 0;
  for (let n = lo; n <= hi; n++) {
    const el = document.createElement('div');
    el.dataset.note = n;
    if (BLACK.has(n % 12)) {
      el.className = 'key black';
      el.style.left = `calc(${wi * w}% - var(--bw) / 2)`;
    } else {
      el.className = 'key white';
      el.style.left = `${wi * w}%`;
      el.style.width = `${w}%`;
      if (n % 12 === 0) {
        const s = document.createElement('span');
        s.className = 'key-label';
        s.textContent = label(n);
        el.appendChild(s);
      }
      wi++;
    }
    keys.set(n, el);
    wrap.appendChild(el);
  }
  root.appendChild(wrap);

  let down = null;
  const noteAt = (e) => {
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const k = t && t.closest && t.closest('.key');
    return k && wrap.contains(k) ? +k.dataset.note : null;
  };
  wrap.addEventListener('pointerdown', (e) => {
    const n = noteAt(e);
    if (n == null) return;
    e.preventDefault();
    down = n;
    wrap.setPointerCapture(e.pointerId);
    onDown(n);
  });
  wrap.addEventListener('pointermove', (e) => {
    if (down == null) return;
    const n = noteAt(e);
    if (n != null && n !== down) {
      onUp(down);
      down = n;
      onDown(n);
    }
  });
  const end = () => {
    if (down != null) onUp(down);
    down = null;
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);

  return {
    set(pressed, rootNote, bassNote) {
      keys.forEach((el, n) => {
        el.classList.toggle('on', pressed.has(n));
        el.classList.toggle('root', n === rootNote);
        el.classList.toggle('bass', n === bassNote);
      });
    },
  };
}
