// Phím đàn vẽ bằng DOM, chỉ để nhìn: sáng theo nốt bạn đang chơi trên đàn thật.

const BLACK = new Set([1, 3, 6, 8, 10]);

export function rangeFor(count) {
  if (count >= 88) return [21, 108];
  if (count >= 76) return [28, 103];
  return [36, 96];
}

export function buildKeyboard(root, { lo, hi, label }) {
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
