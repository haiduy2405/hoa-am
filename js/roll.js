// Piano roll vẽ bằng canvas: xem, chọn, kéo, kéo dài, thêm, xóa nốt; chỉnh lực nhấn ở dải dưới.
import { barBeats } from './songmidi.js';

export const PART_COLORS = ['#d9a441', '#5cb8a5', '#c98bd6', '#e4574d', '#7fa8e8', '#b5c96a', '#e89a6b', '#9aa0b4'];
const KEYS_W = 48;
const RULER_H = 26;
const VEL_H = 56;
const EDGE = 7;
const BLACK = new Set([1, 3, 6, 8, 10]);
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let clip = [];

export class Roll {
  // cx: { song(), partIndex(), sel: Set, grid(), tool(), tick(), cursor(), setCursor(t), begin(), changed(),
  //       audition(part, pitch), label(pitch), selChanged() }
  constructor(canvas, cx) {
    this.c = canvas;
    this.cx = cx;
    this.g = canvas.getContext('2d');
    this.x0 = 0;
    this.ppb = 64;
    this.yTop = 84;
    this.rowH = 14;
    this.drag = null;
    this.hover = null;
    this.raf = 0;
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e));
    canvas.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    canvas.addEventListener('keydown', (e) => { if (this.key(e)) { e.preventDefault(); e.stopPropagation(); } });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
  }

  // ---------- Hệ tọa độ ----------
  get ppq() { return this.cx.song().ppq; }
  get ppt() { return this.ppb / this.ppq; } // pixel mỗi tick
  tx(t) { return KEYS_W + (t - this.x0) * this.ppt; }
  xt(x) { return this.x0 + (x - KEYS_W) / this.ppt; }
  py(n) { return RULER_H + (this.yTop - n) * this.rowH; }
  yp(y) { return Math.floor(this.yTop - (y - RULER_H) / this.rowH); }
  get noteH() { return this.H - RULER_H - VEL_H; }
  snap(t) { const g = this.cx.grid(); return Math.round(t / g) * g; }

  resize() {
    if (!this.cx.song()) return;
    const r = this.c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.W = Math.max(200, r.width);
    this.H = Math.max(200, r.height);
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clampView();
    this.draw();
  }

  clampView() {
    const rows = this.noteH / this.rowH;
    this.yTop = clamp(this.yTop, rows - 1 + 0, 127 + 1);
    this.x0 = Math.max(0, this.x0);
  }

  fit() {
    const song = this.cx.song();
    const part = song.parts[this.cx.partIndex()];
    if (!part || !part.notes.length) { this.x0 = 0; this.yTop = 84; this.draw(); return; }
    let lo = 127, hi = 0, end = 0;
    for (const n of part.notes) { lo = Math.min(lo, n.n); hi = Math.max(hi, n.n); end = Math.max(end, n.t + n.d); }
    const rows = this.noteH / this.rowH;
    const mid = (lo + hi) / 2;
    this.yTop = mid + rows / 2;
    const beats = Math.min(end / this.ppq, 16);
    this.ppb = clamp((this.W - KEYS_W - 20) / Math.max(4, beats), 24, 220);
    this.x0 = 0;
    this.clampView();
    this.draw();
  }

  follow(tick) {
    const x = this.tx(tick);
    if (x > this.W - 40 || x < KEYS_W) {
      this.x0 = Math.max(0, tick - 24 / this.ppt);
    }
  }

  scrollBeats() {
    const song = this.cx.song();
    let end = 0;
    for (const p of song.parts) for (const n of p.notes) end = Math.max(end, n.t + n.d);
    return { max: Math.max(0, end - ((this.W - KEYS_W) / this.ppt) * 0.2), end };
  }

  // ---------- Vẽ ----------
  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.draw(); });
  }

  draw() {
    const g = this.g;
    const { W, H } = this;
    const song = this.cx.song();
    if (!W || !song) return;
    const ppq = song.ppq;
    const grid = this.cx.grid();
    const bg = css('--bg-2', '#1b1525'), panel = css('--panel', '#211a2c'), line = css('--line', 'rgba(236,228,214,.09)');
    const line2 = css('--line-2', 'rgba(236,228,214,.18)'), ink = css('--ink', '#ece4d6'), ink3 = css('--ink-3', '#8b8397'), brass = css('--brass', '#d9a441');
    g.clearRect(0, 0, W, H);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const nh = this.noteH;
    // hàng phím
    const top = Math.ceil(this.yTop), bottom = Math.floor(this.yTop - nh / this.rowH);
    g.save();
    g.beginPath();
    g.rect(KEYS_W, RULER_H, W - KEYS_W, nh);
    g.clip();
    for (let n = top; n >= bottom - 1; n--) {
      const y = this.py(n);
      if (BLACK.has(((n % 12) + 12) % 12)) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(KEYS_W, y, W - KEYS_W, this.rowH); }
      if (n % 12 === 0) { g.fillStyle = line2; g.fillRect(KEYS_W, y + this.rowH - 1, W - KEYS_W, 1); }
    }
    // đường dọc: phách, ô nhịp
    const bb = barBeats(song);
    const t0 = Math.max(0, this.x0), t1 = this.xt(W);
    const subTicks = this.ppb >= 90 ? ppq / 4 : this.ppb >= 44 ? ppq / 2 : ppq;
    for (let t = Math.floor(t0 / subTicks) * subTicks; t <= t1; t += subTicks) {
      const x = Math.round(this.tx(t)) + 0.5;
      const beat = t / ppq;
      const isBar = Math.abs(beat / bb - Math.round(beat / bb)) < 1e-6;
      const isBeat = Math.abs(beat - Math.round(beat)) < 1e-6;
      g.fillStyle = isBar ? line2 : isBeat ? 'rgba(236,228,214,.07)' : 'rgba(236,228,214,.035)';
      g.fillRect(x, RULER_H, 1, nh);
    }
    // nốt: phần khác mờ, phần đang sửa đậm
    const ai = this.cx.partIndex();
    song.parts.forEach((p, i) => {
      if (i === ai) return;
      g.fillStyle = PART_COLORS[i % PART_COLORS.length] + '33';
      for (const n of p.notes) {
        if (n.t + n.d < t0 || n.t > t1) continue;
        const y = this.py(n.n);
        if (y < RULER_H - this.rowH || y > RULER_H + nh) continue;
        g.fillRect(this.tx(n.t), y + 2, Math.max(2, n.d * this.ppt - 1), this.rowH - 4);
      }
    });
    const act = song.parts[ai];
    if (act) {
      const col = PART_COLORS[ai % PART_COLORS.length];
      const sel = this.cx.sel;
      for (const n of act.notes) {
        if (n.t + n.d < t0 || n.t > t1) continue;
        const y = this.py(n.n);
        if (y < RULER_H - this.rowH || y > RULER_H + nh) continue;
        const x = this.tx(n.t), w = Math.max(3, n.d * this.ppt - 1);
        g.globalAlpha = 0.45 + (n.v / 127) * 0.55;
        g.fillStyle = col;
        g.fillRect(x, y + 1, w, this.rowH - 2);
        g.globalAlpha = 1;
        if (sel.has(n)) { g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(x + 1, y + 2, w - 2, this.rowH - 4); }
        if (w > 30 && this.rowH >= 12) { g.fillStyle = 'rgba(0,0,0,.65)'; g.font = '10px system-ui'; g.fillText(this.cx.label(n.n), x + 4, y + this.rowH - 4); }
      }
    }
    // khung kéo chọn
    if (this.drag && this.drag.mode === 'box') {
      const d = this.drag;
      g.fillStyle = 'rgba(217,164,65,.12)';
      g.strokeStyle = brass;
      g.lineWidth = 1;
      const x = Math.min(d.sx, d.x), y = Math.min(d.sy, d.y);
      g.fillRect(x, y, Math.abs(d.x - d.sx), Math.abs(d.y - d.sy));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(d.x - d.sx), Math.abs(d.y - d.sy));
    }
    g.restore();

    // dải lực nhấn
    const vy = H - VEL_H;
    g.fillStyle = panel;
    g.fillRect(KEYS_W, vy, W - KEYS_W, VEL_H);
    g.fillStyle = line2;
    g.fillRect(KEYS_W, vy, W - KEYS_W, 1);
    if (act) {
      const col = PART_COLORS[ai % PART_COLORS.length];
      const sel = this.cx.sel;
      for (const n of act.notes) {
        if (n.t < t0 || n.t > t1) continue;
        const x = Math.round(this.tx(n.t));
        const h = (n.v / 127) * (VEL_H - 8);
        g.fillStyle = sel.has(n) ? ink : col;
        g.fillRect(x, vy + VEL_H - 4 - h, 3, h);
      }
    }
    g.fillStyle = ink3;
    g.font = '10px system-ui';
    g.fillText('Lực nhấn', KEYS_W + 8, vy + 13);

    // thước thời gian
    g.fillStyle = panel;
    g.fillRect(KEYS_W, 0, W - KEYS_W, RULER_H);
    g.fillStyle = line2;
    g.fillRect(KEYS_W, RULER_H - 1, W - KEYS_W, 1);
    g.font = '11px system-ui';
    const barT = bb * ppq;
    const barPx = barT * this.ppt;
    const every = Math.max(1, Math.ceil(34 / barPx));
    for (let b = Math.floor(t0 / barT / every) * every; b * barT <= t1; b += every) {
      const x = Math.round(this.tx(b * barT)) + 0.5;
      if (x < KEYS_W) continue;
      g.fillStyle = line2;
      g.fillRect(x, 8, 1, RULER_H - 9);
      g.fillStyle = ink3;
      g.fillText(String(b + 1), x + 4, 17);
    }
    // phím đàn bên trái
    g.fillStyle = panel;
    g.fillRect(0, 0, KEYS_W, H);
    g.save();
    g.beginPath();
    g.rect(0, RULER_H, KEYS_W, nh);
    g.clip();
    for (let n = top; n >= bottom - 1; n--) {
      const y = this.py(n);
      const blk = BLACK.has(((n % 12) + 12) % 12);
      g.fillStyle = blk ? '#1a1422' : '#d9d2c4';
      g.fillRect(0, y, blk ? KEYS_W * 0.62 : KEYS_W - 1, this.rowH - 1);
      if (n % 12 === 0) { g.fillStyle = '#3a3140'; g.font = '10px system-ui'; g.fillText(this.cx.label(n), KEYS_W - 28, y + this.rowH - 4); }
    }
    g.restore();
    g.fillStyle = bg;
    g.fillRect(0, 0, KEYS_W, RULER_H);
    g.fillRect(0, H - VEL_H, KEYS_W, VEL_H);

    // vạch bắt đầu và vạch đang phát
    const cur = this.cx.cursor();
    if (cur != null) {
      const x = Math.round(this.tx(cur)) + 0.5;
      if (x >= KEYS_W && x <= W) {
        g.strokeStyle = brass;
        g.lineWidth = 1;
        g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        g.setLineDash([]);
        g.fillStyle = brass;
        g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 8); g.fill();
      }
    }
    const pt = this.cx.tick();
    if (pt != null) {
      const x = Math.round(this.tx(pt)) + 0.5;
      if (x >= KEYS_W && x <= W) {
        g.strokeStyle = css('--verd', '#5cb8a5');
        g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
      }
    }
    void grid;
  }

  // ---------- Tìm nốt dưới con trỏ ----------
  part() { return this.cx.song().parts[this.cx.partIndex()]; }

  noteAt(x, y) {
    const p = this.part();
    if (!p) return null;
    const pitch = this.yp(y);
    const t = this.xt(x);
    for (let i = p.notes.length - 1; i >= 0; i--) {
      const n = p.notes[i];
      if (n.n === pitch && t >= n.t - 2 / this.ppt && t <= n.t + n.d + 2 / this.ppt) return n;
    }
    return null;
  }

  velAt(x) {
    const p = this.part();
    if (!p) return null;
    let best = null, bd = 6;
    for (const n of p.notes) {
      const d = Math.abs(this.tx(n.t) + 1 - x);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  pos(e) {
    const r = this.c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // ---------- Chuột ----------
  down(e) {
    if (e.button !== 0) return;
    this.c.focus({ preventScroll: true });
    const { x, y } = this.pos(e);
    const cx = this.cx;
    const nh = this.noteH;
    const now = performance.now();
    const dbl = this.lastDown && now - this.lastDown.t < 380 && Math.hypot(x - this.lastDown.x, y - this.lastDown.y) < 8;
    this.lastDown = { t: now, x, y };
    this.c.setPointerCapture(e.pointerId);
    if (y < RULER_H && x >= KEYS_W) {
      this.drag = { mode: 'scrub' };
      cx.setCursor(Math.max(0, this.snap(this.xt(x))));
      this.draw();
      return;
    }
    if (x < KEYS_W && y >= RULER_H && y < RULER_H + nh) {
      const p = this.part();
      if (p) cx.audition(p, this.yp(y));
      this.drag = { mode: 'key' };
      return;
    }
    if (y >= RULER_H + nh) {
      const n = this.velAt(x);
      if (n) {
        if (!cx.sel.has(n)) { if (!e.shiftKey) cx.sel.clear(); cx.sel.add(n); cx.selChanged(); }
        this.drag = { mode: 'vel', began: false };
        this.setVel(y);
      }
      return;
    }
    if (x < KEYS_W) return;
    const hit = this.noteAt(x, y);
    if (hit) {
      if (e.shiftKey) { cx.sel.has(hit) ? cx.sel.delete(hit) : cx.sel.add(hit); }
      else if (!cx.sel.has(hit)) { cx.sel.clear(); cx.sel.add(hit); }
      cx.selChanged();
      const edge = this.tx(hit.t + hit.d) - x < EDGE && hit.d * this.ppt > EDGE * 1.6;
      this.begin(edge ? 'resize' : 'move', x, y, hit);
      if (!edge) cx.audition(this.part(), hit.n);
      this.draw();
      return;
    }
    const p = this.part();
    if (p && (cx.tool() === 'draw' || dbl)) {
      const t = Math.max(0, Math.floor(this.xt(x) / cx.grid()) * cx.grid());
      const pitch = this.yp(y);
      if (pitch < 0 || pitch > 127) return;
      cx.begin();
      const n = { t, d: cx.grid(), n: pitch, v: 90 };
      p.notes.push(n);
      cx.sel.clear();
      cx.sel.add(n);
      cx.selChanged();
      cx.audition(p, pitch);
      this.begin('resize', x, y, n);
      this.drag.began = true;
      this.drag.created = true;
      this.draw();
      return;
    }
    if (!e.shiftKey) { cx.sel.clear(); cx.selChanged(); }
    this.drag = { mode: 'box', sx: x, sy: y, x, y, base: new Set(cx.sel) };
    this.draw();
  }

  begin(mode, x, y, anchor) {
    const sel = [...this.cx.sel];
    this.drag = {
      mode, sx: x, sy: y, began: false, anchor,
      orig: sel.map((n) => ({ n, t: n.t, d: n.d, p: n.n })),
    };
  }

  setVel(y) {
    const d = this.drag;
    const cx = this.cx;
    if (!d.began) { cx.begin(); d.began = true; }
    const v = clamp(Math.round(((this.H - 4 - y) / (VEL_H - 8)) * 127), 1, 127);
    for (const n of cx.sel) n.v = v;
    this.draw();
  }

  move(e) {
    const { x, y } = this.pos(e);
    const d = this.drag;
    const cx = this.cx;
    if (!d) {
      const edge = x >= KEYS_W && y >= RULER_H && y < RULER_H + this.noteH && (() => { const h = this.noteAt(x, y); return h && this.tx(h.t + h.d) - x < EDGE && h.d * this.ppt > EDGE * 1.6; })();
      this.c.style.cursor = edge ? 'ew-resize' : x < KEYS_W ? 'pointer' : y < RULER_H ? 'col-resize' : cx.tool() === 'draw' ? 'crosshair' : 'default';
      return;
    }
    if (d.mode === 'scrub') { cx.setCursor(Math.max(0, this.snap(this.xt(x)))); this.draw(); return; }
    if (d.mode === 'vel') { this.setVel(y); return; }
    if (d.mode === 'box') {
      d.x = x; d.y = y;
      const x1 = Math.min(d.sx, x), x2 = Math.max(d.sx, x), y1 = Math.min(d.sy, y), y2 = Math.max(d.sy, y);
      const p = this.part();
      cx.sel.clear();
      d.base.forEach((n) => cx.sel.add(n));
      if (p) for (const n of p.notes) {
        const nx1 = this.tx(n.t), nx2 = this.tx(n.t + n.d), ny = this.py(n.n);
        if (nx2 >= x1 && nx1 <= x2 && ny + this.rowH >= y1 && ny <= y2) cx.sel.add(n);
      }
      cx.selChanged();
      this.draw();
      return;
    }
    if (d.mode === 'key') return;
    const dx = x - d.sx, dy = y - d.sy;
    if (!d.began && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    if (!d.began) { cx.begin(); d.began = true; }
    const grid = cx.grid();
    if (d.mode === 'move') {
      let dt = Math.round(dx / this.ppt / grid) * grid;
      let dp = -Math.round(dy / this.rowH);
      let minT = Infinity, minP = Infinity, maxP = -Infinity;
      for (const o of d.orig) { minT = Math.min(minT, o.t); minP = Math.min(minP, o.p); maxP = Math.max(maxP, o.p); }
      dt = Math.max(dt, -minT);
      dp = clamp(dp, -minP, 127 - maxP);
      const prev = d.anchor.n;
      for (const o of d.orig) { o.n.t = o.t + dt; o.n.n = o.p + dp; }
      if (d.anchor.n !== prev) cx.audition(this.part(), d.anchor.n);
    } else {
      let dd = Math.round(dx / this.ppt / grid) * grid;
      for (const o of d.orig) dd = Math.max(dd, grid - o.d);
      for (const o of d.orig) o.n.d = o.d + dd;
    }
    this.draw();
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    try { this.c.releasePointerCapture(e.pointerId); } catch (err) { /* đã nhả */ }
    if (d && d.began) {
      const p = this.part();
      if (p) p.notes.sort((a, b) => a.t - b.t || a.n - b.n);
      this.cx.changed();
    }
    this.draw();
  }

  wheel(e) {
    e.preventDefault();
    const { x } = this.pos(e);
    if (e.ctrlKey || e.metaKey) {
      const before = this.xt(x);
      this.ppb = clamp(this.ppb * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 12, 400);
      this.x0 = Math.max(0, before - (x - KEYS_W) / this.ppt);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      this.x0 = Math.max(0, this.x0 + (e.deltaX || e.deltaY) / this.ppt);
    } else {
      this.yTop += e.deltaY / this.rowH / 2.2;
      this.clampView();
    }
    this.draw();
    this.cx.viewChanged && this.cx.viewChanged();
  }

  // ---------- Bàn phím ----------
  key(e) {
    const cx = this.cx;
    const p = this.part();
    const sel = [...cx.sel];
    const grid = cx.grid();
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'a') { cx.sel.clear(); if (p) p.notes.forEach((n) => cx.sel.add(n)); cx.selChanged(); this.draw(); return true; }
    if (mod && k === 'c') { this.copy(); return true; }
    if (mod && k === 'x') { this.copy(); this.del(); return true; }
    if (mod && k === 'v') { this.paste(); return true; }
    if (mod && k === 'd') { this.duplicate(); return true; }
    if (mod) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') { this.del(); return true; }
    if (!sel.length) return false;
    let dt = 0, dp = 0;
    if (e.key === 'ArrowLeft') dt = -grid;
    else if (e.key === 'ArrowRight') dt = grid;
    else if (e.key === 'ArrowUp') dp = e.shiftKey ? 12 : 1;
    else if (e.key === 'ArrowDown') dp = e.shiftKey ? -12 : -1;
    else return false;
    const minT = Math.min(...sel.map((n) => n.t)), minP = Math.min(...sel.map((n) => n.n)), maxP = Math.max(...sel.map((n) => n.n));
    dt = Math.max(dt, -minT);
    dp = clamp(dp, -minP, 127 - maxP);
    if (!dt && !dp) return true;
    cx.begin();
    for (const n of sel) { n.t += dt; n.n += dp; }
    if (dp) cx.audition(p, sel[0].n);
    p.notes.sort((a, b) => a.t - b.t || a.n - b.n);
    cx.changed();
    this.draw();
    return true;
  }

  del() {
    const p = this.part();
    const sel = this.cx.sel;
    if (!p || !sel.size) return;
    this.cx.begin();
    p.notes = p.notes.filter((n) => !sel.has(n));
    sel.clear();
    this.cx.selChanged();
    this.cx.changed();
    this.draw();
  }

  copy() {
    const sel = [...this.cx.sel];
    if (!sel.length) return;
    const t0 = Math.min(...sel.map((n) => n.t));
    clip = sel.map((n) => ({ dt: n.t - t0, n: n.n, d: n.d, v: n.v }));
  }

  paste() {
    const p = this.part();
    if (!p || !clip.length) return;
    const at = this.cx.cursor() ?? 0;
    this.insert(p, clip, at);
  }

  duplicate() {
    const p = this.part();
    const sel = [...this.cx.sel];
    if (!p || !sel.length) return;
    const t0 = Math.min(...sel.map((n) => n.t));
    const t1 = Math.max(...sel.map((n) => n.t + n.d));
    const grid = this.cx.grid();
    const span = Math.ceil((t1 - t0) / grid) * grid;
    this.insert(p, sel.map((n) => ({ dt: n.t - t0, n: n.n, d: n.d, v: n.v })), t0 + span);
  }

  insert(p, items, at) {
    this.cx.begin();
    this.cx.sel.clear();
    for (const it of items) {
      const n = { t: at + it.dt, d: it.d, n: it.n, v: it.v };
      p.notes.push(n);
      this.cx.sel.add(n);
    }
    p.notes.sort((a, b) => a.t - b.t || a.n - b.n);
    this.cx.selChanged();
    this.cx.changed();
    this.draw();
  }
}
