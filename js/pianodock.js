// Đàn ở đáy màn hình: phím sáng theo phím bạn đang bấm, ô bên trái hiện tên hợp âm và các nốt.
const FIRST = 36, LAST = 96; // C2..C7 theo cách gọi Yamaha: 61 phím như đàn organ
const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// [các quãng so với nốt gốc, hậu tố]
const SHAPES = [
  [[0, 4, 7], ''], [[0, 3, 7], 'm'], [[0, 3, 6], 'dim'], [[0, 4, 8], 'aug'], [[0, 2, 7], 'sus2'], [[0, 5, 7], 'sus4'],
  [[0, 4, 7, 11], 'maj7'], [[0, 4, 7, 10], '7'], [[0, 3, 7, 10], 'm7'], [[0, 3, 6, 10], 'm7b5'], [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 7, 9], '6'], [[0, 3, 7, 9], 'm6'], [[0, 5, 7, 10], '7sus4'], [[0, 2, 4, 7], 'add9'], [[0, 3, 7, 11], 'mMaj7'],
  [[0, 2, 4, 7, 10], '9'], [[0, 2, 4, 7, 11], 'maj9'], [[0, 2, 3, 7, 10], 'm9'],
  [[0, 7], '5'],
];
const key = (a) => [...a].sort((x, y) => x - y).join(',');
const TABLE = SHAPES.map(([iv, suf]) => [key(iv), suf]);

// Trả về tên hợp âm của các nốt đang giữ, hoặc '' nếu chưa thành hợp âm (dưới 2 nốt khác tên).
export function chordName(notes) {
  const arr = [...notes].sort((a, b) => a - b);
  const pcs = [...new Set(arr.map((n) => n % 12))];
  if (pcs.length < 2) return '';
  const bass = arr[0] % 12;
  let best = null;
  for (const root of pcs) {
    const k = key(pcs.map((p) => (p - root + 12) % 12));
    const hit = TABLE.find(([t]) => t === k);
    if (hit) {
      const score = (root === bass ? 0 : 1) + (hit[1] === '5' ? 2 : 0);
      if (!best || score < best.score) best = { root, suf: hit[1], score };
    }
  }
  if (!best) return '';
  return NAMES[best.root] + best.suf + (best.root !== bass ? '/' + NAMES[bass] : '');
}

export function createPianoDock({ root, hub, h, noteLabel, acceptCh }) {
  const held = new Set();
  const chordEl = h('b', { class: 'pd-chord', text: '–' });
  const notesEl = h('span', { class: 'pd-notes', text: 'Bấm một phím trên đàn' });
  const cv = h('canvas', { class: 'pd-keys', 'aria-label': 'Phím đàn' });
  const flow = h('canvas', { class: 'pd-flow', 'aria-hidden': 'true' });
  root.append(flow,
    h('div', { class: 'pd-lane' }, h('div', { class: 'pd-read', 'aria-live': 'polite' }, h('span', { class: 'pd-lbl', text: 'Hợp âm' }), chordEl, h('span', { class: 'pd-lbl', text: 'Đang bấm' }), notesEl)),
    h('div', { class: 'pd-board' }, cv));

  const whites = [];
  for (let n = FIRST; n <= LAST; n++) if (!BLACK.has(n % 12)) whites.push(n);

  // Vị trí ngang của một phím (dùng chung cho phím đàn và nốt bay lên).
  function geo(n, W) {
    const kw = W / whites.length, bw = kw * 0.62;
    if (BLACK.has(n % 12)) return { x: whites.indexOf(n - 1) * kw + kw - bw / 2, w: bw, black: true };
    return { x: whites.indexOf(n) * kw + kw * 0.06, w: kw * 0.88, black: false };
  }

  // Nốt bay lên kiểu Synthesia: giữ phím thì thanh dài ra, nhả tay thì thanh tách ra và bay đi.
  const bars = [];
  const SPEED = 0.016; // rem mỗi ms (16 rem mỗi giây)
  let raf = 0;
  function drawFlow(now) {
    const W = flow.clientWidth, H = flow.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (flow.width !== Math.round(W * dpr) || flow.height !== Math.round(H * dpr)) { flow.width = Math.round(W * dpr); flow.height = Math.round(H * dpr); }
    const g = flow.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const v = SPEED * rem; // px mỗi ms
    for (let i = bars.length - 1; i >= 0; i--) {
      const b = bars[i];
      const top = H - (now - b.t0) * v;
      const bot = b.t1 ? H - (now - b.t1) * v : H;
      if (bot < 0) { bars.splice(i, 1); continue; }
      const { x, w, black } = geo(b.n, W);
      const y = Math.max(-8, top), hh = Math.max(6, bot - y);
      g.fillStyle = black ? '#ff9a3c' : '#ffd84d';
      g.shadowColor = black ? 'rgba(255,154,60,0.9)' : 'rgba(255,216,77,0.9)'; g.shadowBlur = 14;
      g.beginPath(); g.roundRect(x, y, w, hh, Math.min(10, w / 2)); g.fill();
    }
    g.shadowBlur = 0;
  }
  function loop(now) { drawFlow(now); raf = bars.length ? requestAnimationFrame(loop) : 0; }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function draw() {
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const kw = W / whites.length, bh = H * 0.62, bw = kw * 0.62;
    const px = (n) => whites.indexOf(n) * kw;
    whites.forEach((n, i) => {
      const on = held.has(n);
      g.fillStyle = on ? '#ffc93c' : '#f3efe6';
      g.fillRect(i * kw + 0.5, 0, kw - 1, H);
      if (on) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(i * kw + 0.5, 0, kw - 1, H * 0.12); }
      if (n % 12 === 0) { g.fillStyle = on ? '#5a3f00' : '#6b6590'; g.font = '700 ' + Math.max(11, kw * 0.34) + 'px Nunito, sans-serif'; g.textBaseline = 'bottom'; g.fillText(noteLabel(n), i * kw + 5, H - 6); }
    });
    for (let n = FIRST; n <= LAST; n++) {
      if (!BLACK.has(n % 12)) continue;
      const x = px(n - 1) + kw - bw / 2, on = held.has(n);
      g.fillStyle = on ? '#ff9a3c' : '#1f1b3a';
      g.beginPath(); g.roundRect(x, 0, bw, bh, [0, 0, 6, 6]); g.fill();
    }
  }
  function readout() {
    const arr = [...held].sort((a, b) => a - b);
    chordEl.textContent = chordName(arr) || (arr.length === 1 ? noteLabel(arr[0]).replace(/\d+$/, '') : '–');
    notesEl.textContent = arr.length ? arr.map(noteLabel).join('  ') : 'Bấm một phím trên đàn';
    draw();
  }
  hub.on('note', (e) => {
    if (acceptCh && !acceptCh(e.ch)) return;
    noteOn(e.note, e.on);
    readout();
  });
  function noteOn(n, on) {
    if (on) { if (!held.has(n)) { held.add(n); if (n >= FIRST && n <= LAST) { bars.push({ n, t0: performance.now(), t1: 0 }); kick(); } } }
    else { held.delete(n); const now = performance.now(); for (const b of bars) if (b.n === n && !b.t1) b.t1 = now; }
  }
  const releaseAll = () => { for (const n of [...held]) noteOn(n, false); readout(); };
  hub.on('panic', releaseAll);
  new ResizeObserver(draw).observe(cv);
  window.addEventListener('blur', releaseAll);
  draw();
  return { press: (n) => { noteOn(n, true); readout(); }, release: (n) => { noteOn(n, false); readout(); }, held: () => [...held] };
}
