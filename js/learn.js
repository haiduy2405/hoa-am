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
const BEST = 'hoaam.learn.best';
const LIGHT = { R: '#f6dca0', L: '#a6e6d6', B: '#c4bcd8' };
const WIN = { perfect: 70, great: 130, good: 220 }; // cửa sổ chấm theo ms thực
const GRADES = {
  perfect: { t: 'PERFECT', col: '#f3cf88', pts: 300, acc: 1, gauge: 5 },
  great: { t: 'GREAT', col: '#6fc9b3', pts: 200, acc: 0.9, gauge: 3 },
  good: { t: 'GOOD', col: '#b9a4f0', pts: 100, acc: 0.65, gauge: 1.5 },
};
const FEVER_MS = 8000;
const PERFECT_STEP = 10; // cứ mỗi ngần này PERFECT liên tiếp thì thưởng một khoản cố định
const PERFECT_BONUS = 1000;
const MILESTONES = new Set([10, 25, 50, 100, 150, 200, 300, 500]);
const newStats = (groups = 0) => ({ hit: 0, miss: 0, wrong: 0, combo: 0, best: 0, groups, score: 0, perfect: 0, great: 0, good: 0, gauge: 0, fever: false, pstreak: 0, pbest: 0, pLast: -1e9 });
const rankOf = (acc) => (acc >= 0.93 ? 'S' : acc >= 0.82 ? 'A' : acc >= 0.66 ? 'B' : acc >= 0.45 ? 'C' : 'D');
const RANK_TEXT = { S: 'Xuất sắc!', A: 'Rất tốt!', B: 'Khá tốt', C: 'Cố thêm chút nữa', D: 'Luyện thêm nhé' };
const SERIF = '"Newsreader", Georgia, serif';
const SANS = '"Be Vietnam Pro", system-ui, sans-serif';
const DISPLAY = '"Barlow Condensed", "Be Vietnam Pro", system-ui, sans-serif';
const PCT = Array.from({ length: 10 }, (_, i) => [(i + 1) / 10, `${(i + 1) * 10}%`]);

const ROLES = [
  ['right', 'Tay phải'],
  ['left', 'Tay trái'],
  ['split', 'Chia theo nốt'],
  ['back', 'Đệm, đàn tự chơi'],
  ['off', 'Tắt'],
];
const DEF = { mode: 'wait', hands: 'R', speed: 1, look: 3000, kb: 'auto', names: true, others: true, split: 60, vol: { R: 1, L: 1, B: 1 }, fx: true, voice: true };

const QUIET = 0.4; // tay không tập tự chơi nhỏ lại để nghe rõ tay đang tập
function handDefaults(hands, vol) {
  vol.R = hands === 'L' ? QUIET : 1;
  vol.L = hands === 'R' ? QUIET : 1;
}

function loadSet() {
  let o = {};
  try { o = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch (e) { o = {}; }
  const r = { ...DEF, ...o, vol: { ...DEF.vol, ...(o.vol || {}) } };
  const tenth = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0.1, Math.round(+v * 10) / 10)) : d);
  r.speed = tenth(r.speed, 1);
  for (const k of ['R', 'L', 'B']) r.vol[k] = tenth(r.vol[k], 1);
  if (!o.vol) handDefaults(r.hands, r.vol);
  return r;
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
  let stats = newStats();
  const fx = { parts: [], rings: [], beams: [], pop: null, banner: null, comboT: 0, flashT: 0, lastPop: 0, goT: 0, sparks: [] };
  let shownScore = 0;

  // ---------- Âm thanh đếm ngược: 4 tiếng bíp cách nhau 1 giây, tiếng đầu ở 0,25 giây ----------
  const COUNT_LEAD = 3250; // ms thực từ lúc bấm Bắt đầu tới lúc vào bài (khớp tiếng bíp thứ tư)
  let countAudio = null;
  let cdMs = 0; // thời gian đếm ngược còn lại (ms thực). Đếm xong mới chạy bài.
  function playCount() {
    if (set.voice === false) return;
    try {
      if (!countAudio) { countAudio = new Audio('assets/countdown.mp3'); countAudio.preload = 'auto'; }
      const elapsed = (COUNT_LEAD - cdMs) / 1000; // đã đếm được bao lâu (khi tiếp tục sau tạm dừng)
      if (elapsed >= 4) return;
      countAudio.currentTime = Math.max(0, elapsed);
      const pr = countAudio.play();
      if (pr && pr.catch) pr.catch(() => {});
    } catch (e) { /* bỏ qua */ }
  }
  const hush = () => { try { if (countAudio) countAudio.pause(); } catch (e) { /* bỏ qua */ } };
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
    stats = newStats(groups.length);
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
    pos = ms <= 0 ? -lead() : ms;
    cdMs = ms <= 0 ? COUNT_LEAD : 0;
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
  function clearFx() { fx.parts.length = 0; fx.rings.length = 0; fx.beams.length = 0; fx.pop = null; fx.banner = null; fx.flashT = 0; fx.goT = 0; fx.sparks.length = 0; }
  function resetStats() { stats = newStats(groups.length); shownScore = 0; clearFx(); if (els.result) els.result.hidden = true; }
  // Sau BẮT ĐẦU, nốt đầu tiên còn cần chừng ba giây để rơi xuống phím nên người chơi kịp đặt tay.
  const lead = () => Math.max(300, Math.min(set.look * 0.85, 3000 * set.speed));

  // ---------- Hiệu ứng và chấm điểm ----------
  const fxOn = () => set.fx !== false;
  function popup(text, col, sub = '', mult = 0) {
    const now = performance.now();
    if (now - fx.lastPop < 70 && fx.pop && fx.pop.text === text) return;
    fx.lastPop = now;
    fx.pop = { text, col, sub, mult, t: now, kind: text === 'PERFECT' ? 'perfect' : '' };
    if (fx.pop.kind && geo && fxOn()) {
      fx.sparks.length = 0;
      for (let i = 0; i < 9 + Math.min(8, Math.max(0, mult - 1)) * 5; i++) {
        const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 170;
        fx.sparks.push({ dx: Math.cos(a) * r * 1.5, dy: Math.sin(a) * r * 0.55, t0: now + Math.random() * 220, size: 8 + Math.random() * 16, life: 480 + Math.random() * 260 });
      }
    }
  }
  function burst(note, hand, grade) {
    if (!geo || !fxOn()) return;
    const k = geo.map.get(note);
    if (!k) return;
    const now = performance.now();
    const x = k.x + k.w / 2, y = geo.hitY;
    const col = grade === 'perfect' ? '#f3cf88' : COL[hand] || '#fff';
    const count = grade === 'perfect' ? 22 : grade === 'great' ? 15 : 9;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const sp = 0.14 + Math.random() * 0.36;
      fx.parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t0: now, life: 450 + Math.random() * 400, col: Math.random() < 0.35 ? '#ffffff' : col, s: 1.4 + Math.random() * 2.6 });
    }
    if (fx.parts.length > 420) fx.parts.splice(0, fx.parts.length - 420);
    fx.rings.push({ x, y, t0: now, col, r: Math.max(26, k.w * 2.4) });
    fx.beams.push({ x: k.x, w: k.w, t0: now, col });
    if (fx.beams.length > 40) fx.beams.shift();
  }
  const banner = (text, col) => { fx.banner = { text, col, t: performance.now() }; };
  function award(n, grade, d) {
    const G = GRADES[grade];
    const now = performance.now();
    n.res = 'hit';
    stats.hit++; stats[grade]++;
    stats.combo++;
    if (stats.combo > stats.best) stats.best = stats.combo;
    // Chuỗi PERFECT không giới hạn. Điểm chỉ nhân tối đa x4, từ đó trở đi chuỗi dài được thưởng khoản cố định mỗi 10 nhịp.
    // Một hợp âm nhiều nốt chỉ tính là một nhịp. Không PERFECT thì chuỗi về 0.
    let bonus = 0;
    if (grade === 'perfect') {
      if (n.ms - stats.pLast >= GAP) {
        stats.pstreak++;
        if (stats.pstreak % PERFECT_STEP === 0) bonus = PERFECT_BONUS;
      }
      stats.pLast = n.ms;
      stats.pbest = Math.max(stats.pbest, stats.pstreak);
    } else stats.pstreak = 0;
    const pm = Math.min(4, Math.max(1, stats.pstreak));
    const mult = pm * (stats.fever ? 2 : 1);
    stats.score += G.pts * mult + bonus;
    if (stats.fever) stats.gauge = Math.min(100, stats.gauge + 2);
    else {
      stats.gauge = Math.min(100, stats.gauge + G.gauge);
      if (stats.gauge >= 100) { stats.fever = true; banner('FEVER ×2', '#ffb4e4'); }
    }
    fx.comboT = now;
    popup(G.t, G.col, grade === 'perfect' ? '' : d < 0 ? 'Sớm' : 'Trễ', grade === 'perfect' ? stats.pstreak : 0);
    burst(n.n, n.hand, grade);
    if (bonus) banner(`PERFECT ×${stats.pstreak}  +${bonus}`, '#fff1b8');
    else if (MILESTONES.has(stats.combo)) banner('COMBO ' + stats.combo, '#f3cf88');
  }
  function missNote(n) {
    n.res = 'miss';
    stats.miss++;
    stats.combo = 0;
    stats.pstreak = 0;
    stats.gauge = 0;
    stats.fever = false;
    popup('MISS', BAD);
    fx.flashT = performance.now();
  }
  function wrongKey(note) {
    stats.wrong++;
    stats.combo = 0;
    stats.pstreak = 0;
    if (!geo || !fxOn()) return;
    const k = geo.map.get(note);
    if (k) fx.rings.push({ x: k.x + k.w / 2, y: geo.hitY, t0: performance.now(), col: BAD, r: Math.max(20, k.w * 1.8) });
  }

  // ---------- Vòng chạy ----------
  function step() {
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    if (!running || !song) return;
    if (cdMs > 0) { // đang đếm ngược: bài đứng yên, chưa gửi nốt nào
      cdMs -= dt;
      if (cdMs <= 0) { cdMs = 0; fx.goT = now; }
      return;
    }
    if (stats.fever) { stats.gauge -= (dt * 100) / FEVER_MS; if (stats.gauge <= 0) { stats.gauge = 0; stats.fever = false; } }
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
      if (pos < 0) pos = 0;
      cdMs = 0;
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
        hub.send(e.on ? [0x90 | c, e.o.n, Math.max(1, Math.min(127, Math.round(e.o.v * set.vol[e.o.hand])))] : [0x80 | c, e.o.n, 0], ts);
      }
    }
    if (set.mode === 'rhythm') {
      const W = WIN.good * set.speed;
      while (ri < notes.length && notes[ri].ms < pos - W) {
        const n = notes[ri++];
        if (n.req && !n.res) missNote(n);
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
    showResult();
  }

  // ---------- Kỷ lục và màn kết quả ----------
  const bestKey = () => `${(song && song.title) || title}|${notes.length}|${set.hands}|${set.speed}`;
  function readBest() { try { return (JSON.parse(localStorage.getItem(BEST) || '{}') || {})[bestKey()] || null; } catch (e) { return null; } }
  function writeBest(v) { try { const all = JSON.parse(localStorage.getItem(BEST) || '{}') || {}; all[bestKey()] = v; localStorage.setItem(BEST, JSON.stringify(all)); } catch (e) { /* bỏ qua */ } }
  const fmt = (n) => Math.round(n).toLocaleString('vi-VN');
  function showResult() {
    if (set.mode === 'watch' || !els.result) return;
    const game = set.mode === 'rhythm';
    const judged = stats.hit + stats.miss;
    if (game ? !judged : !stats.groups) return;
    let acc;
    if (game) acc = Math.max(0, (stats.perfect + stats.great * GRADES.great.acc + stats.good * GRADES.good.acc) / judged - Math.min(0.2, stats.wrong * 0.006));
    else acc = stats.hit / (stats.hit + stats.wrong * 0.5);
    const rank = rankOf(acc);
    const stars = acc >= 0.88 ? 3 : acc >= 0.68 ? 2 : acc >= 0.45 ? 1 : 0;
    let record = false;
    if (game) {
      const prev = readBest();
      if (!prev || stats.score > prev.score) { record = true; writeBest({ score: stats.score, rank }); }
    }
    const cell = (label, val, cls = '') => h('div', { class: 'rc-cell ' + cls }, h('b', { text: String(val) }), h('span', { text: label }));
    const scoreEl = h('div', { class: 'rc-score', text: '0' });
    els.result.replaceChildren(h('div', { class: 'result-card', role: 'dialog', 'aria-label': 'Kết quả' },
      h('div', { class: 'rc-grade g-' + rank, text: rank }),
      h('div', { class: 'rc-stars', 'aria-label': stars + ' trên 3 sao' }, ...[0, 1, 2].map((i) => h('span', { class: i < stars ? 'on' : '', text: '★' }))),
      h('h3', { text: RANK_TEXT[rank] }),
      game ? scoreEl : null,
      game && record ? h('span', { class: 'rc-record', text: 'Kỷ lục mới' }) : null,
      game ? h('div', { class: 'rc-grid' },
        cell('Perfect', stats.perfect, 'p'), cell('Great', stats.great, 'g'), cell('Good', stats.good, 'o'),
        cell('Miss', stats.miss, 'm'), cell('Perfect liên tiếp', stats.pbest), cell('Chính xác', Math.round(acc * 100) + '%'))
        : h('div', { class: 'rc-grid' }, cell('Nhóm nốt đã qua', `${stats.hit}/${stats.groups}`), cell('Bấm sai', stats.wrong), cell('Chính xác', Math.round(acc * 100) + '%')),
      h('div', { class: 'rc-actions' },
        h('button', { type: 'button', class: 'btn-primary', text: 'Chơi lại', onclick: () => { els.result.hidden = true; seek(0); resetStats(); toggle(); } }),
        h('button', { type: 'button', class: 'btn-ghost', text: 'Đóng', onclick: () => { els.result.hidden = true; } }))));
    els.result.hidden = false;
    if (game) {
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(1, (performance.now() - t0) / 900);
        scoreEl.textContent = fmt(stats.score * (1 - Math.pow(1 - k, 3)));
        if (k < 1 && !els.result.hidden) requestAnimationFrame(tick);
      };
      tick();
    }
    const b = els.result.querySelector('.btn-primary');
    if (b) b.focus({ preventScroll: true });
  }

  function toggle() {
    if (!song) return;
    if (running) { running = false; waiting = false; silence(); hush(); renderPlay(); return; }
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
    if (cdMs > 0) playCount();
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
          if (g.hit.size >= g.pitches.size) {
            g.done = true; g.notes.forEach((x) => { x.res = 'hit'; burst(x.n, x.hand, 'great'); });
            stats.hit++; stats.combo++; stats.best = Math.max(stats.best, stats.combo);
            fx.comboT = t; popup('Đúng', GRADES.great.col);
            if (MILESTONES.has(stats.combo)) banner('CHUỖI ' + stats.combo, '#f3cf88');
          }
        } else { col = BAD; wrongKey(e.note); }
      }
    } else if (running && set.mode === 'rhythm') {
      const W = WIN.good * set.speed;
      let best = null;
      for (let i = ri; i < notes.length && notes[i].ms <= pos + W; i++) {
        const n = notes[i];
        if (!n.req || n.res || n.n !== e.note || Math.abs(n.ms - pos) > W) continue;
        if (!best || Math.abs(n.ms - pos) < Math.abs(best.ms - pos)) best = n;
      }
      if (best) {
        const d = (pos - best.ms) / set.speed;
        const ad = Math.abs(d);
        col = COL[best.hand];
        award(best, ad <= WIN.perfect ? 'perfect' : ad <= WIN.great ? 'great' : 'good', d);
      } else { col = BAD; wrongKey(e.note); }
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

  const hexA = (hex, a) => { const v = parseInt(hex.slice(1), 16); return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`; };
  const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

  function drawOver(g, now) {
    const { hitY } = geo;
    const game = set.mode === 'rhythm';
    // viền sáng khi Fever
    if (game && stats.fever) {
      const a = 0.2 + 0.07 * Math.sin(now / 220);
      for (const side of [0, 1]) {
        const gr = g.createLinearGradient(side ? cw : 0, 0, side ? cw - 150 : 150, 0);
        gr.addColorStop(0, `rgba(240,120,200,${a})`); gr.addColorStop(1, 'rgba(240,120,200,0)');
        g.fillStyle = gr; g.fillRect(side ? cw - 150 : 0, 0, 150, hitY);
      }
    }
    // loé đỏ khi trượt
    if (fx.flashT && now - fx.flashT < 340) {
      const a = 0.24 * (1 - (now - fx.flashT) / 340);
      const gr = g.createLinearGradient(0, hitY - 170, 0, hitY);
      gr.addColorStop(0, 'rgba(238,108,96,0)'); gr.addColorStop(1, `rgba(238,108,96,${a})`);
      g.fillStyle = gr; g.fillRect(0, hitY - 170, cw, 170);
    }
    // vòng sóng
    for (let i = fx.rings.length - 1; i >= 0; i--) {
      const r = fx.rings[i], age = now - r.t0;
      if (age > 460) { fx.rings.splice(i, 1); continue; }
      const k = age / 460;
      g.globalAlpha = (1 - k) * 0.9; g.strokeStyle = r.col; g.lineWidth = 2.5 * (1 - k) + 0.5;
      g.beginPath(); g.ellipse(r.x, r.y, r.r * ease(k), r.r * 0.36 * ease(k), 0, 0, Math.PI * 2); g.stroke();
    }
    // hạt lấp lánh
    for (let i = fx.parts.length - 1; i >= 0; i--) {
      const q = fx.parts[i], age = now - q.t0;
      if (age > q.life) { fx.parts.splice(i, 1); continue; }
      const x = q.x + q.vx * age, y = q.y + q.vy * age + 0.0006 * age * age * 0.5;
      g.globalAlpha = 1 - age / q.life;
      g.fillStyle = q.col;
      g.beginPath(); g.arc(x, y, q.s * (1 - 0.4 * age / q.life), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    // đếm lùi 3, 2, 1 pop up giữa màn hình
    if (running && cdMs > 0) {
      const wall = cdMs / 1000;
      const n = Math.ceil(wall);
      if (n >= 1 && n <= 3) {
        const frac = wall - Math.floor(wall) || 1; // 1 → 0 trong mỗi giây
        const t = 1 - frac; // 0 → 1
        const size = Math.round(Math.min(300, Math.max(120, chh * 0.42)));
        const cy = hitY * 0.5;
        g.fillStyle = 'rgba(10,8,20,0.38)'; g.fillRect(0, 0, cw, hitY);
        const rk = ease(t);
        g.globalAlpha = (1 - t) * 0.8; g.strokeStyle = '#f3cf88'; g.lineWidth = 3;
        g.beginPath(); g.arc(cw / 2, cy, size * (0.42 + 0.6 * rk), 0, Math.PI * 2); g.stroke();
        const sc = 1 + 0.7 * (1 - ease(t * 5));
        const a = t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1;
        g.save(); g.translate(cw / 2, cy); g.scale(sc, sc); g.globalAlpha = a;
        g.fillStyle = '#fff7e0'; g.shadowColor = '#e3b35c'; g.shadowBlur = 46; g.textBaseline = 'middle';
        g.font = `italic 800 ${size}px ${DISPLAY}`; g.fillText(String(n), 0, size * 0.04); g.restore();
        g.globalAlpha = 1;
      }
    }
    if (fx.goT && now - fx.goT < 700) {
      const age = now - fx.goT, a = age < 420 ? 1 : 1 - (age - 420) / 280;
      const size = Math.round(Math.min(170, Math.max(80, chh * 0.24)));
      g.save(); g.translate(cw / 2, hitY * 0.5); g.scale(1 + 0.5 * (1 - ease(age / 160)), 1 + 0.5 * (1 - ease(age / 160))); g.globalAlpha = a;
      g.fillStyle = '#d9fff3'; g.shadowColor = '#6fc9b3'; g.shadowBlur = 40; g.textBaseline = 'middle';
      g.font = `italic 800 ${size}px ${DISPLAY}`; g.fillText('BẮT ĐẦU!', 0, 0); g.restore();
    }
    // số chuỗi (combo)
    if (stats.combo >= 3 && set.mode !== 'watch') {
      const sc = 1 + 0.28 * Math.max(0, 1 - (now - fx.comboT) / 170);
      g.save(); g.translate(cw / 2, hitY * 0.22); g.scale(sc, sc);
      g.textBaseline = 'alphabetic';
      g.fillStyle = 'rgba(244,239,231,0.55)'; g.font = `600 12px ${SANS}`;
      g.fillText(game && stats.fever ? 'FEVER' : set.mode === 'wait' ? 'CHUỖI' : 'COMBO', 0, -66);
      g.font = `italic 800 84px ${DISPLAY}`; g.fillStyle = game && stats.fever ? '#ffc6ea' : '#f4efe7';
      g.shadowColor = game && stats.fever ? '#f078c8' : '#e3b35c'; g.shadowBlur = 22;
      g.fillText(String(stats.combo), 0, 14); g.restore();
    }
    // chữ đánh giá
    if (fx.pop) {
      const perfect = fx.pop.kind === 'perfect';
      const life = perfect ? 980 : 720, hold = perfect ? 700 : 480;
      const age = now - fx.pop.t;
      if (age < life) {
        const a = age < hold ? 1 : 1 - (age - hold) / (life - hold);
        const fs = Math.round(Math.min(78, Math.max(46, chh * 0.1)) * (perfect ? 1.18 : 1));
        const sc = perfect ? 1 + 0.7 * (1 - ease(age / 150)) + 0.04 * Math.sin(age / 90) * (1 - age / life) : 1 + 0.45 * (1 - ease(age / 130));
        const cy = hitY * 0.54;
        g.save(); g.translate(cw / 2, cy);
        g.font = `italic 800 ${fs}px ${DISPLAY}`; g.textBaseline = 'middle';
        try { g.letterSpacing = perfect ? '3px' : '0px'; } catch (e) { /* bỏ qua */ }
        if (perfect && fxOn()) {
          // tia sáng xoay chậm phía sau chữ
          const rot = age / 900, rl = fs * 3.2 * ease(age / 260);
          g.save(); g.rotate(rot); g.globalAlpha = Math.min(1, a * (0.5 + 0.12 * Math.min(6, fx.pop.mult || 1)));
          for (let i = 0; i < 12; i++) {
            g.rotate(Math.PI / 6);
            const gr = g.createLinearGradient(0, 0, rl, 0);
            gr.addColorStop(0, 'rgba(255,232,170,0.55)'); gr.addColorStop(1, 'rgba(255,232,170,0)');
            g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(rl, -fs * 0.11); g.lineTo(rl, fs * 0.11); g.closePath(); g.fill();
          }
          g.restore();
          // vệt sáng ngang
          const fw = cw * 0.55 * ease(age / 240);
          const fl = g.createLinearGradient(-fw, 0, fw, 0);
          fl.addColorStop(0, 'rgba(255,240,200,0)'); fl.addColorStop(0.5, `rgba(255,248,225,${0.95 * a})`); fl.addColorStop(1, 'rgba(255,240,200,0)');
          g.fillStyle = fl; g.fillRect(-fw, -1.5, fw * 2, 3);
        }
        g.scale(sc, sc); g.globalAlpha = a;
        if (perfect) {
          const hw = fs * 2.4;
          const vg = g.createLinearGradient(0, -fs * 0.5, 0, fs * 0.5);
          vg.addColorStop(0, '#fffdf0'); vg.addColorStop(0.45, '#f9dc8e'); vg.addColorStop(1, '#e0a23a');
          g.shadowColor = '#f3b94d'; g.shadowBlur = 34;
          g.lineWidth = Math.max(2, fs * 0.05); g.strokeStyle = 'rgba(120,70,10,0.55)'; g.lineJoin = 'round';
          g.strokeText(fx.pop.text, 0, 0);
          g.fillStyle = vg; g.textAlign = 'center'; g.fillText(fx.pop.text, 0, 0);
          // dải sáng quét qua chữ
          g.shadowBlur = 0;
          const p = ease(Math.min(1, age / 520)) * 2.4 - 0.7;
          const sh = g.createLinearGradient(-hw, 0, hw, 0);
          const c0 = Math.min(1, Math.max(0, p - 0.12)), c1 = Math.min(1, Math.max(0, p)), c2 = Math.min(1, Math.max(0, p + 0.12));
          sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(c0, 'rgba(255,255,255,0)'); sh.addColorStop(c1, 'rgba(255,255,255,0.95)'); sh.addColorStop(c2, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = sh; g.fillText(fx.pop.text, 0, 0);
        } else {
          g.fillStyle = fx.pop.col; g.shadowColor = fx.pop.col; g.shadowBlur = 18; g.textAlign = 'center';
          g.fillText(fx.pop.text, 0, 0);
        }
        try { g.letterSpacing = '0px'; } catch (e) { /* bỏ qua */ }
        g.textAlign = 'center';
        if (perfect && fx.pop.mult >= 2) {
          const m = fx.pop.mult;
          const col = m >= 10 ? `hsl(${Math.round(now / 5) % 360},95%,72%)` : m >= 5 ? '#c78bff' : ['', '', '#ffd36b', '#ff9a5c', '#ff6fb5'][m];
          const k = ease(age / 200);
          g.save(); g.translate(0, fs * 0.86); g.scale(1 + 0.8 * (1 - k) + Math.min(6, m - 2) * 0.1, 1 + 0.8 * (1 - k) + Math.min(6, m - 2) * 0.1);
          g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 20 + Math.min(8, m) * 6;
          g.lineWidth = 3; g.strokeStyle = 'rgba(60,20,10,0.55)'; g.lineJoin = 'round';
          g.font = `italic 800 ${Math.round(fs * 0.7)}px ${DISPLAY}`;
          g.strokeText('×' + m, 0, 0); g.fillText('×' + m, 0, 0);
          g.restore();
        }
        g.shadowBlur = 0;
        if (fx.pop.sub) { g.font = `italic 600 ${Math.round(fs * 0.3)}px ${DISPLAY}`; g.globalAlpha = a * 0.8; g.fillStyle = fx.pop.col; g.fillText(fx.pop.sub.toUpperCase(), 0, fs * 0.66); }
        g.restore();
        // sao lấp lánh quanh chữ PERFECT
        if (perfect && fxOn()) {
          for (const sp of fx.sparks) {
            const k = (now - sp.t0) / sp.life;
            if (k < 0 || k > 1) continue;
            const tw = Math.sin(k * Math.PI);
            const r = sp.size * tw;
            const x = cw / 2 + sp.dx, y = cy + sp.dy;
            g.save(); g.translate(x, y); g.rotate(k * 1.2); g.globalAlpha = tw; g.fillStyle = '#fff6d6'; g.shadowColor = '#f3cf88'; g.shadowBlur = 14;
            g.beginPath();
            for (let i = 0; i < 8; i++) { const rr2 = i % 2 ? r * 0.22 : r; const ang = (i * Math.PI) / 4; g.lineTo(Math.cos(ang) * rr2, Math.sin(ang) * rr2); }
            g.closePath(); g.fill(); g.restore();
          }
        }
      }
    }
    // biểu ngữ FEVER, mốc combo
    if (fx.banner) {
      const age = now - fx.banner.t;
      if (age < 1100) {
        const a = age < 760 ? 1 : 1 - (age - 760) / 340;
        const sc = 1.35 - 0.35 * ease(age / 180);
        g.save(); g.translate(cw / 2, hitY * 0.68); g.scale(sc, sc); g.globalAlpha = a;
        g.fillStyle = fx.banner.col; g.shadowColor = fx.banner.col; g.shadowBlur = 28; g.textBaseline = 'middle';
        g.font = `italic 800 60px ${DISPLAY}`; g.fillText(fx.banner.text, 0, 0); g.restore();
      }
    }
    g.textAlign = 'start'; g.globalAlpha = 1;
  }

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
    bg.addColorStop(0, '#0f0c1a'); bg.addColorStop(1, '#1a1430');
    g.fillStyle = bg; g.fillRect(0, 0, cw, chh);
    { // làn xen kẽ rất nhạt cho dễ canh phím
      let wi = 0;
      g.fillStyle = 'rgba(255,255,255,0.018)';
      for (let n = geo.lo; n <= geo.hi; n++) { const k = map.get(n); if (k.black) continue; if (wi++ % 2) g.fillRect(k.x, 0, k.w, hitY); }
    }
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

    // tia sáng từ phím vừa chạm
    for (let bi = fx.beams.length - 1; bi >= 0; bi--) {
      const b = fx.beams[bi], age = now - b.t0;
      if (age > 520) { fx.beams.splice(bi, 1); continue; }
      const a = 0.42 * (1 - age / 520);
      const gr = g.createLinearGradient(0, hitY, 0, hitY - 190);
      gr.addColorStop(0, hexA(b.col, a)); gr.addColorStop(1, hexA(b.col, 0));
      g.fillStyle = gr; g.fillRect(b.x, hitY - 190, b.w, 190);
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
      if (done && set.mode === 'rhythm') continue; // nốt trúng thì tan đi
      const sounding = n.ms <= pos && pos < n.end;
      const inset = k.black ? 1 : 1.5;
      const x = k.x + inset, w = Math.max(3, k.w - inset * 2);
      g.globalAlpha = missed ? 0.25 : n.req ? 1 : set.mode === 'watch' ? 0.95 : 0.55;
      if (missed) g.fillStyle = '#6b6478';
      else { const gr = g.createLinearGradient(0, yb - hh, 0, yb); gr.addColorStop(0, LIGHT[n.hand]); gr.addColorStop(1, col); g.fillStyle = gr; }
      if (n.req && !missed && !done && n.ms - pos < 700 && n.ms > pos - 60) { g.shadowColor = col; g.shadowBlur = 16; }
      rr(g, x, yb - hh, w, hh, 6); g.fill();
      g.shadowBlur = 0;
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
    drawOver(g, now);
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
    else if (set.mode === 'rhythm') text = '';
    else text = 'Chế độ xem: đàn tự chơi cả bài';
    const combo = '';
    const wait = waiting && need.length ? 'Đợi bạn: ' + need.join(' ') : '';
    const noIn = set.mode !== 'watch' && !hub.activeInput;
    const k = [text, combo, wait, noIn, set.mode, tickText(pos)].join('|');
    if (k !== hudKey) {
      hudKey = k;
      els.stat.textContent = text;
      els.stat.hidden = !text;
      els.game.hidden = set.mode !== 'rhythm';
      els.bestEl.textContent = readBest() ? 'Kỷ lục ' + fmt(readBest().score) : '';
      els.combo.textContent = combo;
      els.combo.hidden = !combo;
      els.wait.textContent = wait;
      els.wait.hidden = !wait;
      els.banner.hidden = !noIn;
      els.time.textContent = tickText(pos);
    }
    if (set.mode === 'rhythm') {
      shownScore += (stats.score - shownScore) * 0.22;
      if (Math.abs(stats.score - shownScore) < 1) shownScore = stats.score;
      const t = fmt(shownScore);
      if (els.scoreEl.textContent !== t) els.scoreEl.textContent = t;
      const pm = Math.min(4, Math.max(1, stats.pstreak));
      els.multEl.textContent = '×' + pm * (stats.fever ? 2 : 1);
      els.multEl.dataset.m = String(pm);
      els.pstrEl.textContent = stats.pstreak >= 2 ? String(stats.pstreak) : '–';
      const judged = stats.hit + stats.miss;
      els.accEl.textContent = judged ? Math.round(((stats.perfect + stats.great * GRADES.great.acc + stats.good * GRADES.good.acc) / judged) * 100) + '%' : '100%';
      els.gaugeFill.style.width = stats.gauge.toFixed(1) + '%';
      els.game.classList.toggle('fever', stats.fever);
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
      h('div', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Tên nốt trên nốt rơi' }), tog('Hiện', () => set.names, (v) => { set.names = v; save(); })),
      h('div', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Âm thanh đếm ngược' }), tog('Bật', () => set.voice !== false, (v) => { set.voice = v; save(); if (!v) hush(); }, 'Phát ra loa máy tính')),
      h('div', { class: 'lp-row' }, h('span', { class: 'lp-name', text: 'Hiệu ứng lấp lánh' }), tog('Bật', () => set.fx !== false, (v) => { set.fx = v; save(); if (!v) clearFx(); })));
  }

  function mount() {
    els.volSel = {};
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
          sel('Tốc độ phát', PCT, () => set.speed, (v) => { set.speed = +v; save(); }))),
      h('div', { class: 'learn-row' },
        seg('Chế độ', [['watch', 'Xem'], ['wait', 'Đợi tôi'], ['rhythm', 'Thử thách']], () => set.mode, (v) => { set.mode = v; save(); resetStats(); rebuild(); }),
        seg('Tay tập', [['R', 'Tay phải'], ['L', 'Tay trái'], ['RL', 'Hai tay']], () => set.hands, (v) => { set.hands = v; handDefaults(v, set.vol); for (const k of ['R', 'L']) if (els.volSel && els.volSel[k]) els.volSel[k].value = String(set.vol[k]); save(); resetStats(); rebuild(); }),
        tog('Đàn chơi phần còn lại', () => set.others, (v) => { set.others = v; save(); rebuild(); }, 'Bật: đàn tự chơi tay không tập, đệm và trống'),
        loopBtn, els.loopFields),
      h('div', { class: 'learn-row' },
        h('span', { class: 'sb-lbl', text: 'Âm lượng đàn tự chơi:' }),
        ...[['R', 'Tay phải'], ['L', 'Tay trái'], ['B', 'Đệm, trống']].map(([k, t]) => h('label', { class: 'sb-lbl' }, h('span', { text: t }),
          (els.volSel[k] = sel('Âm lượng ' + t, PCT, () => set.vol[k], (v) => { set.vol[k] = +v; save(); }))))));

    els.canvas = h('canvas', { class: 'learn-canvas', 'aria-label': 'Nốt rơi xuống phím đàn' });
    els.stat = h('span', { class: 'hud-stat' });
    els.combo = h('span', { class: 'hud-chip', hidden: true });
    els.wait = h('span', { class: 'hud-chip wait', hidden: true });
    els.banner = h('div', { class: 'learn-banner', hidden: true },
      h('span', { text: 'Chưa thấy đàn gửi nốt. Nối đàn qua USB, hoặc chọn chế độ Xem.' }),
      h('button', { type: 'button', class: 'btn-ghost small', text: 'Kết nối đàn', onclick: () => env.openDevice() }));
    els.panel = h('div', { class: 'learn-panel', hidden: true });
    els.hud = h('div', { class: 'learn-hud' }, els.stat, els.combo, els.wait);
    els.scoreEl = h('output', { class: 'g-score', 'aria-label': 'Điểm', text: '0' });
    els.multEl = h('span', { class: 'g-mult', text: '×1' });
    els.accEl = h('span', { class: 'g-acc', text: '100%' });
    els.bestEl = h('span', { class: 'g-best' });
    els.pstrEl = h('span', { class: 'g-acc', text: '–' });
    els.gaugeFill = h('i', { class: 'g-fill' });
    els.game = h('div', { class: 'game-hud', hidden: true },
      h('div', { class: 'g-top' }, h('span', { class: 'g-lbl', text: 'Điểm' }), els.multEl),
      els.scoreEl,
      h('div', { class: 'g-gauge', title: 'Đầy thanh là vào Fever: điểm nhân đôi' }, els.gaugeFill, h('span', { class: 'g-gauge-lbl', text: 'FEVER' })),
      h('div', { class: 'g-foot' }, h('span', { text: 'Perfect liên tiếp' }), els.pstrEl),
      h('div', { class: 'g-foot' }, h('span', { text: 'Chính xác' }), els.accEl),
      els.bestEl);
    els.result = h('div', { class: 'learn-result', hidden: true });
    els.stage = h('div', { class: 'learn-stage' }, els.canvas, els.hud, els.game, els.banner, els.result, els.panel);
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
    clearFx(); shownScore = 0; if (els.result) els.result.hidden = true;
    pos = 0;
    els.root.hidden = false;
    document.body.classList.add('learn-open');
    layout();
    try { document.fonts.load('italic 800 60px "Barlow Condensed"'); document.fonts.load('italic 600 20px "Barlow Condensed"'); } catch (e) { /* bỏ qua */ }
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
    hush();
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
    peek: () => ({ pos, next: notes.find((n) => n.req && !n.res) || null, running }),
    layout,
  };
}
