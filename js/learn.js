// Chế độ học bài: nốt rơi xuống phím đàn, đợi bạn chơi đúng tay phải, tay trái rồi mới đi tiếp.
// Phần còn lại của bài (tay kia, đệm, trống) do đàn tự chơi qua cổng MIDI out.
import { barBeats, makeClock, songEnd } from './songmidi.js';

const BLACK = new Set([1, 3, 6, 8, 10]);
const COL = { R: '#e3b35c', L: '#6fc9b3', B: '#9a90b5' };
const BAD = '#ee6c60';
const LEAD = 1200; // ms dẫn vào trước nốt đầu để kịp nhìn nốt rơi
const EARLY = 320; // chế độ đợi: bấm sớm tối đa bấy nhiêu ms (theo thời gian bài) vẫn tính đúng
const GAP = 40; // nốt cách nhau dưới ngần này ms được xem là một hợp âm
const STORE = 'hoaam.learn';

const ROLES = [
  ['right', 'Tay phải'],
  ['left', 'Tay trái'],
  ['split', 'Chia theo nốt'],
  ['back', 'Đệm, đàn tự chơi'],
  ['off', 'Tắt'],
];
const DEF = { mode: 'wait', hands: 'R', speed: 1, look: 3000, kb: 'auto', names: true, others: true, split: 60 };

function loadSet() {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (e) { return { ...DEF }; }
}

function defaultRoles(s) {
  const m = new Map();
  const cand = s.parts.filter((p) => p.channel !== 9 && p.notes.length);
  s.parts.forEach((p) => m.set(p.id, p.channel === 9 ? 'back' : p.notes.length ? 'back' : 'off'));
  if (cand.length === 1) m.set(cand[0].id, 'split');
  else if (cand.length > 1) {
    const avg = (p) => p.notes.reduce((a, n) => a + n.n, 0) / p.notes.length;
    const sorted = [...cand].sort((a, b) => avg(b) - avg(a));
    m.set(sorted[0].id, 'right');
    m.set(sorted[1].id, 'left');
  }
  return m;
}

export function createLearn(env) {
  const { h, hub } = env;
  const set = loadSet();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(set)); } catch (e) { /* bỏ qua */ } };

  let song = null, clock = null, bb = 4, title = '';
  let roles = new Map();
  let notes = [], groups = [], autoEv = [], maxDur = 0, total = 0;
  let pos = -LEAD, running = false, waiting = false, finished = false, last = 0;
  let gi = 0, ri = 0, ap = 0;
  let stats = { hit: 0, miss: 0, wrong: 0, combo: 0, best: 0, groups: 0 };
  const keys = new Map(); // phím người chơi: { col, held, until }
  let open = false, timer = 0, raf = 0, dragging = false, warnedOut = false;
  let loop = { on: false, a: 1, b: 4 };
  const els = {};
  let geo = null, cw = 0, chh = 0, dpr = 1;

  // ---------- Dựng dữ liệu từ bài ----------
  function build() {
    notes = []; autoEv = []; groups = [];
    clock = makeClock(song);
    bb = barBeats(song);
    const practice = set.mode === 'watch' ? '' : set.hands;
    const playOthers = set.mode === 'watch' || set.others;
    song.parts.forEach((p, pi) => {
      const role = roles.get(p.id) || 'off';
      if (role === 'off') return;
      const drum = p.channel === 9;
      let anyReq = false;
      for (const n of p.notes) {
        let hand = role === 'right' ? 'R' : role === 'left' ? 'L' : role === 'split' ? (n.n >= set.split ? 'R' : 'L') : 'B';
        if (drum) hand = 'B';
        const req = practice.includes(hand);
        if (req) anyReq = true;
        const o = { ms: clock.tickToMs(n.t), end: clock.tickToMs(n.t + n.d), n: n.n, v: n.v, hand, req, drum, pi, auto: !req && playOthers, res: 0 };
        notes.push(o);
        if (o.auto) {
          autoEv.push({ ms: o.ms, on: true, o });
          autoEv.push({ ms: o.end, on: false, o });
        }
      }
      if (!anyReq && playOthers) for (const c of p.ctl) autoEv.push({ ms: clock.tickToMs(c[0]), raw: c, pi });
    });
    notes.sort((a, b) => a.ms - b.ms || a.n - b.n);
    autoEv.sort((a, b) => a.ms - b.ms || (a.on ? 1 : 0) - (b.on ? 1 : 0));
    maxDur = notes.reduce((m, n) => Math.max(m, n.end - n.ms), 0);
    total = clock.tickToMs(songEnd(song));
    for (const n of notes) {
      if (!n.req) continue;
      const g = groups[groups.length - 1];
      if (g && n.ms - g.ms < GAP) { g.pitches.add(n.n); g.hands.set(n.n, n.hand); g.notes.push(n); } else groups.push({ ms: n.ms, pitches: new Set([n.n]), hands: new Map([[n.n, n.hand]]), notes: [n], hit: new Set(), done: false });
    }
    stats = { hit: 0, miss: 0, wrong: 0, combo: 0, best: 0, groups: groups.length };
    seek(Math.max(pos, 0) === 0 ? 0 : pos);
  }

  // ---------- Âm thanh gửi sang đàn ----------
  const chans = () => [...new Set(song.parts.map((p) => p.channel & 15))];
  function silence() {
    if (!song) return;
    for (const c of chans()) { hub.send([0xb0 | c, 123, 0]); hub.send([0xb0 | c, 64, 0]); }
  }
  function setupParts() {
    const used = new Set(notes.filter((n) => n.auto).map((n) => n.pi));
    song.parts.forEach((p, pi) => {
      if (!used.has(pi)) return;
      const c = p.channel & 15;
      if (p.channel !== 9) hub.send([0xc0 | c, p.program & 127]);
      if (p.vol != null) hub.send([0xb0 | c, 7, Math.max(0, Math.min(127, p.vol))]);
      if (p.pan != null) hub.send([0xb0 | c, 10, p.pan]);
    });
  }

  // ---------- Tua ----------
  function seek(ms) {
    silence();
    pos = ms <= 0 ? -LEAD : ms;
    groups.forEach((g) => { g.done = g.ms < pos - 1e-6; g.hit.clear(); });
    gi = 0;
    while (gi < groups.length && groups[gi].done) gi++;
    for (const n of notes) n.res = n.req && n.ms < pos - 1e-6 ? 'skip' : 0;
    ri = 0;
    ap = 0;
    while (ap < autoEv.length && autoEv[ap].ms < pos - 1e-6) ap++;
    finished = false;
    waiting = false;
  }
  const loopMs = () => ({ a: clock.tickToMs(Math.max(0, loop.a - 1) * bb * song.ppq), b: clock.tickToMs(Math.max(loop.a, loop.b) * bb * song.ppq) });
  function resetStats() { stats = { hit: 0, miss: 0, wrong: 0, combo: 0, best: 0, groups: groups.length }; }

  // ---------- Vòng chạy ----------
  function step() {
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    if (!running || !song) return;
    let target = pos + dt * set.speed;
    while (gi < groups.length && groups[gi].done) gi++;
    waiting = false;
    let cap = Infinity;
    if (set.mode === 'wait' && gi < groups.length) {
      const g = groups[gi];
      cap = g.ms - 1e-3;
      if (target >= g.ms) { target = g.ms; waiting = true; }
    }
    const lm = loop.on ? loopMs() : null;
    if (lm && target >= lm.b) {
      if (set.mode === 'rhythm') resetStats();
      seek(lm.a);
      return;
    }
    pos = target;
    if (lm) cap = Math.min(cap, lm.b - 1e-3);
    // Gửi nốt tự chơi trước 40ms để đều nhịp
    const horizon = Math.min(pos + 40 * set.speed, cap);
    while (ap < autoEv.length && autoEv[ap].ms <= horizon) {
      const e = autoEv[ap++];
      const ts = now + Math.max(0, (e.ms - pos) / set.speed);
      if (e.raw) {
        const c = song.parts[e.pi].channel & 15;
        const [, type, d1, d2] = e.raw;
        if (type !== 0xc0) hub.send(type === 0xd0 ? [type | c, d1] : [type | c, d1, d2], ts);
      } else {
        const c = song.parts[e.o.pi].channel & 15;
        hub.send(e.on ? [0x90 | c, e.o.n, e.o.v] : [0x80 | c, e.o.n, 0], ts);
      }
    }
    if (set.mode === 'rhythm') {
      const W = 220 * set.speed;
      while (ri < notes.length && notes[ri].ms < pos - W) {
        const n = notes[ri++];
        if (n.req && !n.res) { n.res = 'miss'; stats.miss++; stats.combo = 0; }
      }
    }
    if (pos >= total + 500 && !loop.on) finish();
  }
  function finish() {
    running = false;
    finished = true;
    waiting = false;
    silence();
    renderPlay();
    env.toast('Hết bài. ' + summary());
  }
  function summary() {
    if (set.mode === 'rhythm') {
      const t = stats.hit + stats.miss;
      return t ? `Đúng ${stats.hit}/${t} nốt (${Math.round((stats.hit / t) * 100)}%), chuỗi dài nhất ${stats.best}.` : '';
    }
    if (set.mode === 'wait') return stats.groups ? `Qua ${stats.hit}/${stats.groups} nhóm nốt, bấm sai ${stats.wrong} lần.` : '';
    return '';
  }

  function toggle() {
    if (!song) return;
    if (running) { running = false; waiting = false; silence(); renderPlay(); return; }
    if (!hub.activeOutput && !warnedOut) {
      warnedOut = true;
      env.toast(set.mode === 'watch' ? 'Chưa nối cổng MIDI ra nên đàn chưa phát tiếng. Bấm Kết nối đàn để chọn.' : 'Chưa nối cổng MIDI ra: phần đàn tự chơi sẽ im lặng. Bạn vẫn tập được.');
    }
    if (finished || pos >= total + 400) { seek(0); resetStats(); }
    if (set.mode === 'watch' && !hub.activeOutput) env.openDevice();
    setupParts();
    running = true;
    last = performance.now();
    renderPlay();
  }

  // ---------- Nốt từ đàn của người chơi ----------
  function onNote(e) {
    if (!open || !song || !env.acceptCh(e.ch)) return;
    const t = performance.now();
    if (!e.on) {
      const k = keys.get(e.note);
      if (k) { k.held = false; k.until = t + 140; }
      return;
    }
    let col = null;
    if (running && set.mode === 'wait') {
      const g = groups[gi];
      if (g && g.ms - pos <= EARLY) {
        if (g.pitches.has(e.note)) {
          col = COL[g.hands.get(e.note)];
          g.hit.add(e.note);
          if (g.hit.size >= g.pitches.size) { g.done = true; g.notes.forEach((x) => { x.res = 'hit'; }); stats.hit++; stats.combo++; stats.best = Math.max(stats.best, stats.combo); }
        } else { col = BAD; stats.wrong++; stats.combo = 0; }
      }
    } else if (running && set.mode === 'rhythm') {
      const W = 220 * set.speed;
      let best = null;
      for (let i = ri; i < notes.length && notes[i].ms <= pos + W; i++) {
        const n = notes[i];
        if (!n.req || n.res || n.n !== e.note || Math.abs(n.ms - pos) > W) continue;
        if (!best || Math.abs(n.ms - pos) < Math.abs(best.ms - pos)) best = n;
      }
      if (best) { best.res = 'hit'; col = COL[best.hand]; stats.hit++; stats.combo++; stats.best = Math.max(stats.best, stats.combo); } else { col = BAD; stats.wrong++; stats.combo = 0; }
    }
    keys.set(e.note, { col: col || '#fff3d6', held: true, until: 0, t });
  }
  hub.on('note', onNote);
  hub.on('panic', () => keys.clear());

  // ---------- Bàn phím và vùng vẽ ----------
  function range() {
    if (set.kb === '88') return [21, 108];
    if (set.kb === '61') return [36, 96];
    let lo = 127, hi = 0;
    for (const n of notes) if (!n.drum) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); }
    if (lo > hi) return [36, 96];
    lo = Math.floor(lo / 12) * 12;
    hi = Math.floor(hi / 12) * 12 + 11;
    while (hi - lo + 1 < 48) {
      if (lo - 12 >= 21 && (lo - 21 >= 108 - hi || hi + 12 > 108)) lo -= 12;
      else if (hi + 12 <= 108) hi += 12;
      else break;
    }
    return [Math.max(21, lo), Math.min(108, hi)];
  }
  function layout() {
    if (!els.canvas) return;
    const r = els.stage.getBoundingClientRect();
    cw = Math.max(1, Math.floor(r.width));
    chh = Math.max(1, Math.floor(r.height));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    els.canvas.width = cw * dpr;
    els.canvas.height = chh * dpr;
    els.canvas.style.width = cw + 'px';
    els.canvas.style.height = chh + 'px';
    if (!song) return;
    const [lo, hi] = range();
    const whites = [];
    for (let n = lo; n <= hi; n++) if (!BLACK.has(n % 12)) whites.push(n);
    const ww = cw / whites.length;
    const kbH = Math.round(Math.max(64, Math.min(chh * 0.24, ww * 5.4)));
    const map = new Map();
    let wi = 0;
    const bw = ww * 0.62;
    for (let n = lo; n <= hi; n++) {
      if (BLACK.has(n % 12)) map.set(n, { x: wi * ww - bw / 2, w: bw, black: true });
      else { map.set(n, { x: wi * ww, w: ww, black: false }); wi++; }
    }
    geo = { lo, hi, ww, kbH, hitY: chh - kbH, map, whites };
  }

  const rr = (g, x, y, w, hh, r) => { r = Math.min(r, w / 2, hh / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const shortName = (n) => env.noteLabel(n).replace(/-?\d+$/, '');

  function draw() {
    if (!open || !geo || !song) return;
    const g = els.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { hitY, kbH, map } = geo;
    const now = performance.now();
    const ppm = hitY / set.look;
    const yOf = (ms) => hitY - (ms - pos) * ppm;

    // nền và vạch quãng tám
    const bg = g.createLinearGradient(0, 0, 0, hitY);
    bg.addColorStop(0, '#0f0d15'); bg.addColorStop(1, '#171320');
    g.fillStyle = bg; g.fillRect(0, 0, cw, chh);
    g.lineWidth = 1;
    for (let n = geo.lo; n <= geo.hi; n++) {
      if (n % 12 !== 0 || BLACK.has(n % 12)) continue;
      const k = map.get(n);
      g.strokeStyle = 'rgba(243,238,230,0.07)';
      g.beginPath(); g.moveTo(Math.round(k.x) + 0.5, 0); g.lineTo(Math.round(k.x) + 0.5, hitY); g.stroke();
    }
    // vạch ô nhịp và phách
    const visEnd = pos + set.look;
    const beatMs = (b) => clock.tickToMs(b * song.ppq);
    const b0 = Math.max(0, Math.floor(clock.msToTick(Math.max(0, pos)) / song.ppq));
    g.font = '600 12px "Be Vietnam Pro", system-ui, sans-serif';
    g.textBaseline = 'top';
    for (let b = b0; b < b0 + 400; b++) {
      const ms = beatMs(b);
      if (ms > visEnd) break;
      const y = yOf(ms);
      if (y > hitY) continue;
      const bar = b % bb === 0;
      g.strokeStyle = bar ? 'rgba(243,238,230,0.2)' : 'rgba(243,238,230,0.06)';
      g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(cw, Math.round(y) + 0.5); g.stroke();
      if (bar) { g.fillStyle = 'rgba(243,238,230,0.45)'; g.fillText(String(Math.floor(b / bb) + 1), 8, y + 4); }
    }
    // đoạn lặp
    if (loop.on) {
      const lm = loopMs();
      g.fillStyle = 'rgba(111,201,179,0.9)';
      for (const m of [lm.a, lm.b]) { const y = yOf(m); if (y >= 0 && y <= hitY) g.fillRect(0, y - 1, cw, 2); }
    }

    // nốt rơi
    const lit = new Map();
    const need = new Map();
    g.save();
    g.beginPath(); g.rect(0, 0, cw, hitY); g.clip();
    let i = 0;
    { let lo = 0, hi = notes.length; const from = pos - maxDur - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].ms < from) lo = m + 1; else hi = m; } i = lo; }
    const showNames = set.names;
    for (; i < notes.length; i++) {
      const n = notes[i];
      if (n.ms > visEnd) break;
      if (n.drum || n.end < pos - 1) continue;
      const k = map.get(n.n);
      if (!k) continue;
      const yb = yOf(n.ms), yt = yOf(n.end);
      const hh = Math.max(7, yb - yt);
      const col = COL[n.hand];
      const done = n.res === 'hit';
      const missed = n.res === 'miss';
      const sounding = n.ms <= pos && pos < n.end;
      const inset = k.black ? 1 : 1.5;
      const x = k.x + inset, w = Math.max(3, k.w - inset * 2);
      g.globalAlpha = missed ? 0.25 : n.req ? 1 : set.mode === 'watch' ? 0.95 : 0.55;
      g.fillStyle = missed ? '#6b6478' : col;
      rr(g, x, yb - hh, w, hh, 6); g.fill();
      if (n.req) { g.globalAlpha = 0.55; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1; rr(g, x + 0.5, yb - hh + 0.5, w - 1, hh - 1, 6); g.stroke(); }
      if (done || sounding) { g.globalAlpha = 0.28; g.fillStyle = '#fff'; rr(g, x, yb - hh, w, hh, 6); g.fill(); }
      g.globalAlpha = 1;
      if (showNames && w >= 22 && hh >= 18) {
        g.fillStyle = missed ? 'rgba(255,255,255,0.4)' : '#1a1308';
        g.font = '600 12px "Be Vietnam Pro", system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.fillText(shortName(n.n), x + w / 2, yb - 4);
        g.textAlign = 'start';
      }
      if (sounding && n.auto) lit.set(n.n, { col, a: 0.8 });
      if (n.req && !n.res && n.ms - pos <= 250 && n.ms >= pos - 250) need.set(n.n, col);
    }
    g.restore();

    // đường chạm
    const glow = g.createLinearGradient(0, hitY - 26, 0, hitY);
    glow.addColorStop(0, 'rgba(227,179,92,0)');
    glow.addColorStop(1, waiting ? 'rgba(227,179,92,0.55)' : 'rgba(227,179,92,0.22)');
    g.fillStyle = glow; g.fillRect(0, hitY - 26, cw, 26);
    g.fillStyle = waiting ? '#f3cf88' : '#e3b35c';
    g.fillRect(0, hitY - 2, cw, 2);

    // phím đàn
    for (const [n, k] of keys) if (!k.held && k.until < now) keys.delete(n);
    const path = (k) => (k.black ? rr(g, k.x, hitY - 1, k.w, kbH * 0.62, 3) : rr(g, k.x + 0.5, hitY, k.w - 1, kbH - 1, 4));
    const paintKey = (n, k) => {
      g.fillStyle = k.black ? '#1b1722' : '#efe9df';
      path(k); g.fill();
      const a = lit.get(n);
      if (a) { g.globalAlpha = a.a; g.fillStyle = a.col; path(k); g.fill(); g.globalAlpha = 1; }
      const u = keys.get(n);
      if (u) { g.fillStyle = u.col; path(k); g.fill(); }
    };
    for (let n = geo.lo; n <= geo.hi; n++) {
      const k = map.get(n);
      if (k.black) continue;
      paintKey(n, k);
      if (n % 12 === 0 && !keys.has(n)) {
        g.fillStyle = 'rgba(30,24,40,0.55)'; g.font = '500 11px "Be Vietnam Pro", system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'bottom';
        g.fillText(env.noteLabel(n), k.x + k.w / 2, hitY + kbH - 6); g.textAlign = 'start';
      }
    }
    g.strokeStyle = 'rgba(20,16,28,0.55)'; g.lineWidth = 1;
    for (let n = geo.lo; n <= geo.hi; n++) { const k = map.get(n); if (!k.black) { g.beginPath(); g.moveTo(Math.round(k.x) + 0.5, hitY); g.lineTo(Math.round(k.x) + 0.5, hitY + kbH); g.stroke(); } }
    for (let n = geo.lo; n <= geo.hi; n++) { const k = map.get(n); if (k.black) paintKey(n, k); }
    // dấu hiệu "chơi phím này": thanh sáng nhấp nháy trên phím cần bấm
    const pulse = 0.55 + 0.45 * Math.sin(now / 160);
    for (const [n, col] of need) {
      const k = map.get(n);
      g.globalAlpha = waiting ? pulse : 0.7;
      g.fillStyle = col;
      rr(g, k.x + 1, hitY - 7, k.w - 2, 7, 3); g.fill();
      g.globalAlpha = 1;
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, hitY + kbH - 1, cw, 1);
  }

  function frame() {
    if (!open) return;
    step();
    draw();
    updateHud();
    raf = requestAnimationFrame(frame);
  }

  // ---------- HUD ----------
  const tickText = (ms) => {
    const t = clock.msToTick(Math.max(0, ms)) / song.ppq;
    const bar = Math.floor(t / bb + 1e-9);
    return `Ô ${bar + 1}, phách ${Math.floor(t - bar * bb + 1e-9) + 1}`;
  };
  let hudKey = '';
  function updateHud() {
    if (!song) return;
    const need = [];
    if (waiting && groups[gi]) for (const n of groups[gi].pitches) if (!groups[gi].hit.has(n)) need.push(shortName(n));
    let text = '';
    if (set.mode === 'wait') text = stats.groups ? `Đã qua ${stats.hit}/${stats.groups}  ·  Sai ${stats.wrong}` : 'Không có nốt cho tay đã chọn';
    else if (set.mode === 'rhythm') { const t = stats.hit + stats.miss; text = `Đúng ${stats.hit}  ·  Trượt ${stats.miss}  ·  Sai ${stats.wrong}  ·  ${t ? Math.round((stats.hit / t) * 100) : 100}%`; }
    else text = 'Chế độ xem: đàn tự chơi cả bài';
    const combo = stats.combo >= 3 && set.mode !== 'watch' ? `Chuỗi ${stats.combo}` : '';
    const wait = waiting && need.length ? 'Đợi bạn: ' + need.join(' ') : '';
    const noIn = set.mode !== 'watch' && !hub.activeInput;
    const k = [text, combo, wait, noIn, tickText(pos)].join('|');
    if (k !== hudKey) {
      hudKey = k;
      els.stat.textContent = text;
      els.combo.textContent = combo;
      els.combo.hidden = !combo;
      els.wait.textContent = wait;
      els.wait.hidden = !wait;
      els.banner.hidden = !noIn;
      els.time.textContent = tickText(pos);
    }
    if (!dragging && total > 0) els.seek.value = String(Math.max(0, Math.min(total, pos)));
  }

  // ---------- Giao diện ----------
  const seg = (label, opts, get, on) => {
    const box = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const paint = () => [...box.children].forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === get())));
    opts.forEach(([v, t]) => box.append(h('button', { type: 'button', text: t, onclick: () => { on(v); paint(); } })));
    paint();
    return box;
  };
  const sel = (label, opts, get, on) => {
    const s = h('select', { 'aria-label': label }, opts.map(([v, t]) => h('option', { value: String(v), text: t, selected: String(v) === String(get()) })));
    s.addEventListener('change', () => on(s.value));
    return s;
  };
  const tog = (text, get, on, title) => {
    const b = h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(get()), text, title, onclick: () => { on(!get()); b.setAttribute('aria-pressed', String(get())); } });
    return b;
  };

  function renderPlay() {
    if (!els.play) return;
    els.play.setAttribute('aria-pressed', String(running));
    els.play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' + (running ? '<rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>' : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>') + '</svg><span>' + (running ? 'Tạm dừng' : finished ? 'Chơi lại' : 'Bắt đầu') + '</span>';
  }

  function rebuild(keepPos = true) {
    const p = keepPos ? pos : 0;
    const was = running;
    running = false;
    silence();
    pos = p;
    build();
    if (was) { setupParts(); running = true; last = performance.now(); }
    layout();
    renderPlay();
  }

  function renderPanel() {
    const rows = song.parts.filter((p) => p.notes.length).map((p) => h('label', { class: 'lp-row' },
      h('span', { class: 'lp-name', text: p.name || 'Phần ' + (song.parts.indexOf(p) + 1) }),
      sel('Vai trò của phần này', ROLES, () => roles.get(p.id), (v) => { roles.set(p.id, v); rebuild(); })));
    const splitOpts = [48, 55, 60, 64, 67, 72].map((n) => [n, env.noteLabel(n)]);
    els.panel.replaceChildren(
      h('div', { class: 'lp-head' }, h('b', { text: 'Phân tay' }), h('button', { type: 'button', class: 'btn-ghost small', 'aria-label': 'Đóng', text: 'Đóng', onclick: () => { els.panel.hidden = true; } })),
      h('p', { class: 'hint', text: 'Chọn phần nào là tay phải, tay trái. "Chia theo nốt" tách một phần piano ra hai tay tại nốt bên dưới.' }),
      ...rows,
      h('label', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Điểm chia hai tay' }), sel('Điểm chia', splitOpts, () => set.split, (v) => { set.split = +v; save(); rebuild(); })),
      h('div', { class: 'lp-head lp-sep' }, h('b', { text: 'Hiển thị' })),
      h('label', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Độ dài đường rơi' }),
        sel('Độ dài đường rơi', [[2000, 'Ngắn, rơi nhanh'], [3000, 'Vừa'], [4500, 'Dài'], [6500, 'Rất dài, rơi chậm']], () => set.look, (v) => { set.look = +v; save(); })),
      h('label', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Số phím' }),
        sel('Số phím', [['auto', 'Vừa với bài'], ['61', '61 phím'], ['88', '88 phím']], () => set.kb, (v) => { set.kb = v; save(); layout(); })),
      h('div', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Tên nốt trên nốt rơi' }), tog('Hiện', () => set.names, (v) => { set.names = v; save(); })));
  }

  function mount() {
    els.root = h('div', { class: 'learn', role: 'dialog', 'aria-label': 'Học bài theo nốt rơi', hidden: true });
    els.title = h('b', { class: 'learn-title' });
    els.full = h('button', { type: 'button', class: 'btn-ghost', text: 'Toàn màn hình', onclick: toggleFull });
    els.out = h('button', { type: 'button', class: 'out-chip', onclick: () => env.openDevice() });
    els.panelBtn = h('button', { type: 'button', class: 'btn-ghost', text: 'Phân tay', onclick: () => { els.panel.hidden = !els.panel.hidden; } });
    const top = h('div', { class: 'learn-top' },
      h('button', { type: 'button', class: 'btn-ghost', text: '← Quay lại', onclick: close }),
      els.title, h('span', { class: 'tools-spacer' }), els.out, els.panelBtn, els.full);

    els.play = h('button', { type: 'button', class: 'play', onclick: toggle });
    els.time = h('output', { class: 'learn-time' });
    els.seek = h('input', { type: 'range', class: 'learn-seek', min: 0, max: 1, step: 1, value: 0, 'aria-label': 'Vị trí trong bài' });
    els.seek.addEventListener('pointerdown', () => { dragging = true; });
    els.seek.addEventListener('input', () => { seek(+els.seek.value); });
    els.seek.addEventListener('change', () => { dragging = false; });
    els.seek.addEventListener('pointerup', () => { dragging = false; });
    const loopA = h('input', { type: 'number', min: 1, value: loop.a, 'aria-label': 'Lặp từ ô nhịp', class: 'mini' });
    const loopB = h('input', { type: 'number', min: 1, value: loop.b, 'aria-label': 'Đến ô nhịp', class: 'mini' });
    loopA.addEventListener('change', () => { loop.a = Math.max(1, Math.round(+loopA.value || 1)); loop.b = Math.max(loop.a, loop.b); loopB.value = loop.b; if (loop.on) seek(loopMs().a); });
    loopB.addEventListener('change', () => { loop.b = Math.max(loop.a, Math.round(+loopB.value || loop.a)); loopB.value = loop.b; });
    els.loopFields = h('span', { class: 'loop-fields', hidden: true }, loopA, h('span', { text: 'đến' }), loopB);
    els.loopA = loopA; els.loopB = loopB;
    const loopBtn = tog('Lặp đoạn', () => loop.on, (v) => {
      loop.on = v; els.loopFields.hidden = !v;
      if (v) { const bar = Math.max(1, Math.floor(clock.msToTick(Math.max(0, pos)) / (bb * song.ppq)) + 1); loop.a = bar; loop.b = bar + 3; loopA.value = loop.a; loopB.value = loop.b; }
    }, 'Lặp một đoạn để tập cho thuộc');

    const deck = h('div', { class: 'learn-deck' },
      h('div', { class: 'learn-row' },
        els.play,
        h('button', { type: 'button', class: 'btn-ghost small', text: 'Về đầu', onclick: () => { seek(0); resetStats(); running = false; silence(); renderPlay(); } }),
        els.seek, els.time,
        h('label', { class: 'sb-lbl' }, h('span', { text: 'Tốc độ' }),
          sel('Tốc độ phát', [[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%']], () => set.speed, (v) => { set.speed = +v; save(); }))),
      h('div', { class: 'learn-row' },
        seg('Chế độ', [['watch', 'Xem'], ['wait', 'Đợi tôi'], ['rhythm', 'Theo nhịp']], () => set.mode, (v) => { set.mode = v; save(); resetStats(); rebuild(); }),
        seg('Tay tập', [['R', 'Tay phải'], ['L', 'Tay trái'], ['RL', 'Hai tay']], () => set.hands, (v) => { set.hands = v; save(); resetStats(); rebuild(); }),
        tog('Đàn chơi phần còn lại', () => set.others, (v) => { set.others = v; save(); rebuild(); }, 'Bật: đàn tự chơi tay không tập, đệm và trống'),
        loopBtn, els.loopFields));

    els.canvas = h('canvas', { class: 'learn-canvas', 'aria-label': 'Nốt rơi xuống phím đàn' });
    els.stat = h('span', { class: 'hud-stat' });
    els.combo = h('span', { class: 'hud-chip', hidden: true });
    els.wait = h('span', { class: 'hud-chip wait', hidden: true });
    els.banner = h('div', { class: 'learn-banner', hidden: true },
      h('span', { text: 'Chưa thấy đàn gửi nốt. Nối đàn qua USB, hoặc chọn chế độ Xem.' }),
      h('button', { type: 'button', class: 'btn-ghost small', text: 'Kết nối đàn', onclick: () => env.openDevice() }));
    els.panel = h('div', { class: 'learn-panel', hidden: true });
    els.hud = h('div', { class: 'learn-hud' }, els.stat, els.combo, els.wait);
    els.stage = h('div', { class: 'learn-stage' }, els.canvas, els.hud, els.banner, els.panel);
    els.root.append(top, deck, els.stage);
    document.body.append(els.root);
    new ResizeObserver(() => { if (open) layout(); }).observe(els.stage);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', () => { els.full.textContent = document.fullscreenElement === els.root ? 'Thoát toàn màn hình' : 'Toàn màn hình'; if (open) requestAnimationFrame(layout); });
  }

  function onKey(e) {
    if (!open || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (k === 'f') { e.preventDefault(); toggleFull(); }
    else if (k === 'escape' && !document.fullscreenElement) { e.preventDefault(); close(); }
    else if (k === 'r') { e.preventDefault(); seek(0); resetStats(); }
  }

  async function toggleFull() {
    if (document.fullscreenElement === els.root) await document.exitFullscreen().catch(() => {});
    else await els.root.requestFullscreen().catch(() => env.toast('Trình duyệt không cho toàn màn hình. Trang đã phủ kín cửa sổ rồi.'));
  }

  function renderOut() {
    if (!els.out) return;
    const o = hub.activeOutput, i = hub.activeInput;
    els.out.classList.toggle('ok', !!(o && i));
    els.out.textContent = i ? 'Đàn: ' + (i.name || 'đã nối') : 'Chưa nối đàn';
    els.out.title = o ? 'Phần đàn tự chơi phát qua: ' + (o.name || 'đàn') : 'Chưa có cổng MIDI ra';
  }
  hub.on('devices', renderOut);

  // ---------- Công khai ----------
  function openSong(s, name = '') {
    if (!s) return;
    if (!els.root) mount();
    song = s;
    title = name;
    roles = defaultRoles(s);
    open = true;
    running = false;
    finished = false;
    keys.clear();
    pos = 0;
    els.root.hidden = false;
    document.body.classList.add('learn-open');
    layout();
    els.title.textContent = title || s.title || 'Bài MIDI';
    clock = makeClock(s);
    bb = barBeats(s);
    build();
    total = Math.max(total, 1);
    els.seek.max = String(Math.ceil(total));
    renderPanel();
    renderOut();
    renderPlay();
    hudKey = '';
    requestAnimationFrame(() => { layout(); });
    clearInterval(timer);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(frame);
    els.play.focus({ preventScroll: true });
  }

  function close() {
    if (!open) return;
    open = false;
    running = false;
    cancelAnimationFrame(raf);
    silence();
    keys.clear();
    if (document.fullscreenElement === els.root) document.exitFullscreen().catch(() => {});
    els.root.hidden = true;
    document.body.classList.remove('learn-open');
  }

  return {
    open: openSong, close, toggle,
    isOpen: () => open,
    isRunning: () => open && running,
    // dành cho kiểm thử
    debug: () => ({ pos, gi, groups: groups.length, waiting, stats: { ...stats }, mode: set.mode, hands: set.hands, notes: notes.length, running, need: groups[gi] ? [...groups[gi].pitches] : [], needMs: groups[gi] ? groups[gi].ms : null, roles: song ? song.parts.map((p) => [p.name, roles.get(p.id), p.channel]) : [], reqNotes: notes.filter((n) => n.req).length }),
    layout,
  };
}
