// Phòng nhạc MIDI: mở file .mid, nghe qua đàn, chỉnh âm sắc, âm lượng từng phần, đổi tông, tải lại, và học bài.
import {
  GM, barBeats, makeClock, makeSong, parseMidi, scaleTempo, serializeSong, songEnd, transposeNotes, writeMidi,
} from './songmidi.js';
import { Player } from './player.js';
import { createLearn } from './learn.js';

export const PART_COLORS = ['#d9a441', '#5cb8a5', '#c98bd6', '#e4574d', '#7fa8e8', '#b5c96a', '#e89a6b', '#9aa0b4'];

export function createStudio(env) {
  const { h, hub } = env;
  const root = env.root;
  let song = null;
  let cursor = 0; // tick bắt đầu phát
  let loop = false;
  let undo = [];
  let redo = [];
  let raf = 0;
  let fileName = '';
  const mix = { mute: new Set(), solo: new Set(), vol: new Map() };
  const els = {};
  const learn = createLearn({ h, hub, toast: (m) => env.toast(m), noteLabel: (n) => env.noteLabel(n), openDevice: () => env.openDevice(), acceptCh: (c) => env.acceptCh(c), pickFile: () => pickFile(), openKho: () => env.openKho() });

  const player = new Player({
    hub,
    getMix: () => ({ mute: mix.mute, solo: mix.solo.size ? mix.solo : null, vol: mix.vol }),
    onEnd: () => { stopLoop(); cursor = 0; renderBar(); updateProgress(0); },
  });

  const snapshot = () => JSON.stringify({ s: serializeSong(song), ids: song.parts.map((p) => p.id) });
  const fromSnapshot = (str) => {
    const d = JSON.parse(str);
    const s = makeSong(d.s);
    s.parts.forEach((p, i) => { p.id = d.ids[i]; });
    return s;
  };

  // ---------- Hoàn tác ----------
  function begin() {
    if (player.active) stopPlay();
    undo.push(snapshot());
    if (undo.length > 60) undo.shift();
    redo = [];
  }
  function changed() {
    env.onSongChange(song);
    renderBar();
    renderHead();
    renderPreview();
    renderParts();
  }
  function applySnapshot(str) {
    stopPlay();
    song = fromSnapshot(str);
    env.onSongChange(song);
    renderAll();
  }
  function doUndo() {
    if (!undo.length) return false;
    redo.push(snapshot());
    applySnapshot(undo.pop());
    return true;
  }
  function doRedo() {
    if (!redo.length) return false;
    undo.push(snapshot());
    applySnapshot(redo.pop());
    return true;
  }

  // ---------- Phát ----------
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const tickText = (t) => {
    const clk = makeClock(song);
    return `${fmt(clk.tickToMs(t))} / ${fmt(clk.tickToMs(endTick()))}`;
  };
  const endTick = () => Math.max(1, songEnd(song));
  function updateProgress(t) {
    if (!song || !els.time) return;
    els.time.textContent = tickText(t);
    if (els.seek) els.seek.value = String(Math.round(t));
    const pct = Math.min(100, (t / endTick()) * 100) + '%';
    els.parts.querySelectorAll('.ph').forEach((e) => { e.style.left = pct; });
    if (els.pline) els.pline.style.bottom = pct;
  }
  function startPlay() {
    if (!song) return;
    if (!hub.activeOutput) {
      env.toast('Chưa nối đàn. Bấm Kết nối đàn, chọn cổng MIDI ra là đàn của bạn, rồi phát lại.');
      env.openDevice();
      return;
    }
    player.start(song, cursor, { loop });
    startLoop();
    renderBar();
  }
  function stopPlay() {
    if (player.active) { cursor = Math.min(player.tick(), endTick()); player.stop(); }
    stopLoop();
    renderBar();
    updateProgress(cursor);
  }
  function togglePlay() { if (learn.isOpen()) { learn.toggle(); return; } player.active ? stopPlay() : startPlay(); }
  function openLearn() { if (!song) return; stopPlay(); learn.open(song, song.title || fileName); }
  function startLoop() {
    cancelAnimationFrame(raf);
    const f = () => {
      if (!player.active) return;
      updateProgress(player.tick());
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

  // ---------- Dựng giao diện ----------
  const btn = (text, onclick, cls = 'btn-ghost small', extra = {}) => h('button', { type: 'button', class: cls, onclick, text, ...extra });

  function build() {
    root.replaceChildren();
    els.empty = h('div', { class: 'studio-empty' },
      h('div', { class: 'empty-main' },
        h('p', { class: 'studio-lead', text: 'Chọn một bài để chơi nào!' }),
        h('p', { class: 'hint', text: 'Nối đàn bằng cáp USB (cổng USB TO HOST), bật đàn rồi chọn bài. Bạn cũng có thể kéo file .mid thả vào đây.' }),
        h('div', { class: 'studio-empty-actions' }, btn('Chọn bài từ kho', () => env.openKho(), 'btn-primary big'), btn('Nhập File .mid', pickFile, 'btn-ghost big'))),
      els.recent = h('div', { class: 'recent' }));

    els.view = h('div', { class: 'studio-view', hidden: true });
    els.head = h('div', { class: 'studio-head' });
    els.bar = h('div', { class: 'studio-bar', role: 'toolbar', 'aria-label': 'Điều khiển phát' });
    els.parts = h('div', { class: 'studio-parts', role: 'list', 'aria-label': 'Các phần nhạc cụ' });
    els.preview = h('div', { class: 'preview' });
    els.opts = h('div', { class: 'opts' });
    els.dock = h('div', { class: 'dock' });
    els.mixer = h('dialog', { class: 'mixer-dlg' }, h('div', { class: 'dlg' }, h('h3', { text: 'Nhạc cụ của bài' }),
      h('p', { class: 'sub', text: 'Đổi âm sắc, chỉnh âm lượng, tắt tiếng từng phần.' }), els.parts,
      h('div', { class: 'dlg-actions' }, btn('Xuất file .mid', () => exportMid(), 'btn-ghost big'), btn('Xong', () => els.mixer.close(), 'btn-primary big'))));
    els.mixer.addEventListener('click', (e) => { if (e.target === els.mixer) els.mixer.close(); });
    els.view.append(els.head, els.bar, els.preview, els.opts, els.dock, els.mixer);
    root.append(els.empty, els.view);
  }

  function renderRecent() {
    const list = env.recent().slice(0, 5);
    els.recent.replaceChildren(h('b', { text: 'Bài gần đây' }), ...(list.length ? list.map((s) => {
      const m = (env.meta && env.meta(s.id)) || {};
      const sub = m.artist || m.cat || 'File của bạn';
      const st = env.stars ? env.stars(s.title) : 0;
      return h('button', { type: 'button', class: 'recent-item', onclick: () => env.openSaved(s.id) },
        h('span', { class: 'ri-text' }, h('b', { text: s.title || 'Bài chưa đặt tên' }), h('small', { text: sub })),
        h('span', { class: 'ri-stars', 'aria-label': st + ' trên 3 sao' }, ...[0, 1, 2].map((k) => h('i', { class: k < st ? 'on' : '', text: '★' }))));
    }) : [h('p', { class: 'hint', text: 'Bài bạn mở sẽ hiện ở đây, lần sau bấm là vào ngay.' })]));
  }

  function renderHead() {
    const title = h('input', { class: 'studio-name', type: 'text', value: song.title || fileName || '', placeholder: 'Đặt tên bài', maxlength: 80, 'aria-label': 'Tên bài', autocomplete: 'off' });
    title.addEventListener('change', () => { song.title = title.value.trim(); env.onSongChange(song); });
    els.head.replaceChildren(
      h('div', { class: 'studio-title' }, title,
        h('span', { text: `${song.parts.length} phần, ${song.parts.reduce((a, p) => a + p.notes.length, 0).toLocaleString('vi-VN')} nốt` })),
      h('div', { class: 'studio-head-actions' },
        els.out = h('button', { type: 'button', class: 'out-chip', onclick: () => env.openDevice() })));
    renderOut();
  }

  function renderOpts() {
    if (!els.opts) return;
    const group = (label, key, choices) => h('div', { class: 'opt-group' }, h('span', { class: 'opt-lbl', text: label }),
      h('div', { class: 'opt-btns' }, ...choices.map(([v, t]) => h('button', { type: 'button', class: 'opt-btn', 'aria-pressed': String(learn.getOpt(key) === v), text: t, onclick: () => { learn.setOpt(key, v); renderOpts(); } }))));
    els.opts.replaceChildren(
      group('Cách chơi', 'mode', [['wait', 'Đợi tôi'], ['rhythm', 'Theo nhịp'], ['watch', 'Xem trước']]),
      group('Tay tập', 'hands', [['R', 'Tay phải'], ['L', 'Tay trái'], ['RL', 'Hai tay']]),
      group('Tốc độ', 'speed', [[0.5, 'Chậm'], [0.8, 'Vừa'], [1, 'Chuẩn']]));
  }

  function renderDock() {
    const big = (text, sub, fn, cls, extra = {}) => h('button', { type: 'button', class: 'dock-btn ' + cls, onclick: fn, ...extra }, h('b', { text }), sub ? h('small', { text: sub }) : null);
    els.dock.replaceChildren(
      big('Hủy bài', '', closeSong, 'dk-side dk-cancel', { title: 'Đóng bài này, bài vẫn được lưu' }),
      big('VÀO CHƠI', 'Nốt rơi, chơi đúng để ghi điểm', openLearn, 'dk-play', { id: 'btn-learn' }));
  }

  // Sơ đồ nốt rơi: cả bài trên một khung, đầu bài ở dưới (chỗ nốt chạm phím), cuối bài ở trên.
  function renderPreview() {
    if (!song || !els.preview) return;
    const cv = h('canvas', { class: 'pv-cv', 'aria-label': 'Sơ đồ nốt rơi của cả bài' });
    els.pline = h('i', { class: 'pv-line' });
    els.preview.replaceChildren(h('div', { class: 'pv-head' }, h('b', { text: 'Sơ đồ bài hát' })), h('div', { class: 'pv-box' }, cv, els.pline));
    // Bấm giữ rồi kéo lên/xuống như timeline: đáy = đầu bài, đỉnh = cuối bài.
    const box0 = cv.parentElement;
    const scrub = (e) => {
      const r = box0.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
      cursor = Math.round(f * endTick());
      if (player.active) player.setFrom(cursor);
      updateProgress(cursor);
    };
    box0.addEventListener('pointerdown', (e) => { box0.setPointerCapture(e.pointerId); box0.classList.add('drag'); scrub(e); });
    box0.addEventListener('pointermove', (e) => { if (box0.hasPointerCapture(e.pointerId)) scrub(e); });
    const up = (e) => { box0.classList.remove('drag'); if (box0.hasPointerCapture(e.pointerId)) box0.releasePointerCapture(e.pointerId); };
    box0.addEventListener('pointerup', up); box0.addEventListener('pointercancel', up);
    const draw = () => {
      const box = cv.parentElement; if (!box || !box.clientWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const W = box.clientWidth, H = box.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const g = cv.getContext('2d'); g.scale(dpr, dpr);
      const end = endTick();
      const all = song.parts.filter((p) => p.channel !== 9).flatMap((p) => p.notes);
      const lo = Math.max(0, Math.min(48, ...all.map((n) => n.n)) - 1), hi = Math.min(127, Math.max(84, ...all.map((n) => n.n)) + 1);
      const span = hi - lo + 1, kw = W / span;
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let k = lo; k <= hi; k++) if ([1, 3, 6, 8, 10].includes(k % 12)) g.fillRect((k - lo) * kw, 0, kw, H);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let k = lo; k <= hi; k++) if (k % 12 === 0) g.fillRect((k - lo) * kw, 0, 1, H);
      song.parts.forEach((p, i) => {
        if (p.channel === 9) return;
        g.fillStyle = PART_COLORS[i % PART_COLORS.length];
        for (const n of p.notes) {
          const y1 = H - (n.t / end) * H, h2 = Math.max(2, (n.d / end) * H);
          g.globalAlpha = 0.9;
          g.beginPath(); g.roundRect((n.n - lo) * kw + 0.5, y1 - h2, Math.max(2, kw - 1), h2, 2); g.fill();
        }
      });
      g.globalAlpha = 1;
    };
    requestAnimationFrame(draw);
    if (els.pvRO) els.pvRO.disconnect();
    els.pvRO = new ResizeObserver(draw); els.pvRO.observe(cv.parentElement);
    updateProgress(player.active ? player.tick() : cursor);
  }

  function renderBar() {
    if (!song || !els.bar) return;
    const playing = player.active;
    const play = h('button', { type: 'button', class: 'play', 'aria-pressed': String(playing), onclick: togglePlay });
    play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' + (playing ? '<rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>' : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>') + '</svg><span>' + (playing ? 'Dừng' : 'Nghe thử') + '</span>';
    els.time = h('output', { class: 'studio-time', 'aria-label': 'Thời gian', text: tickText(playing ? player.tick() : cursor) });
    els.seek = h('input', { type: 'range', class: 'studio-seek', min: 0, max: endTick(), step: 1, value: Math.round(playing ? player.tick() : cursor), 'aria-label': 'Vị trí trong bài' });
    els.seek.addEventListener('input', () => {
      cursor = +els.seek.value;
      if (player.active) player.setFrom(cursor);
      updateProgress(cursor);
    });
    els.bar.replaceChildren(play, els.seek, els.time);
  }

  // Dải mật độ nốt của một phần: nhìn là biết đoạn nào có nhạc, không cần cuộn piano roll.
  function strip(p, col) {
    const cv = h('canvas', { class: 'strip-cv', width: 480, height: 36, 'aria-hidden': 'true' });
    const g = cv.getContext('2d');
    const end = endTick();
    const W = cv.width, H = cv.height;
    const lo = p.channel === 9 ? 0 : Math.min(127, ...p.notes.map((n) => n.n));
    const hi = p.channel === 9 ? 127 : Math.max(lo + 12, ...p.notes.map((n) => n.n));
    g.fillStyle = col;
    for (const n of p.notes) {
      const x = (n.t / end) * W;
      const w = Math.max(1.5, (n.d / end) * W);
      const y = p.channel === 9 ? H / 2 : H - 3 - ((n.n - lo) / (hi - lo)) * (H - 8);
      g.fillRect(x, y - 1.5, w, 3);
    }
    return h('div', { class: 'strip' }, cv, h('i', { class: 'ph' }));
  }

  function renderParts() {
    if (!song) return;
    const rows = song.parts.map((p, i) => {
      const col = PART_COLORS[i % PART_COLORS.length];
      const drum = p.channel === 9;
      const name = h('input', { class: 'pname', type: 'text', value: p.name, maxlength: 40, 'aria-label': 'Tên phần', placeholder: drum ? 'Trống' : 'Nhạc cụ' });
      name.addEventListener('change', () => { begin(); p.name = name.value.trim(); changed(); });
      const prog = drum ? h('span', { class: 'pprog drum', text: 'Bộ trống' }) : h('select', { class: 'pprog', 'aria-label': 'Âm sắc' }, GM.map((g, k) => h('option', { value: k, text: `${k + 1}. ${g}`, selected: k === p.program })));
      if (!drum) prog.addEventListener('change', () => { begin(); p.program = +prog.value; changed(); });
      const vol = h('input', { type: 'range', min: 0, max: 150, value: Math.round((mix.vol.get(p.id) ?? 1) * 100), 'aria-label': 'Âm lượng phần này', class: 'pvol' });
      vol.addEventListener('input', () => { mix.vol.set(p.id, vol.value / 100); if (player.active) player.volume(p, vol.value / 100); });
      const ms = (key, label, title) => h('button', {
        type: 'button', class: 'ms', 'aria-pressed': String(mix[key].has(p.id)), title, 'aria-label': title,
        onclick: () => { mix[key].has(p.id) ? mix[key].delete(p.id) : mix[key].add(p.id); renderParts(); },
      }, label);
      const del = h('button', { type: 'button', class: 'ms del', title: 'Xóa phần này', 'aria-label': 'Xóa phần này', onclick: () => removePart(i) }, '×');
      return h('div', { class: 'part', role: 'listitem', style: `--pc:${col}` },
        h('div', { class: 'part-top' }, h('i', { class: 'pdot' }), name, ms('mute', 'M', 'Tắt tiếng'), ms('solo', 'S', 'Chỉ nghe phần này'), del),
        h('div', { class: 'part-bot' }, prog, vol),
        strip(p, col),
        h('div', { class: 'part-meta', text: `Kênh ${p.channel + 1}, ${p.notes.length.toLocaleString('vi-VN')} nốt` }));
    });
    els.parts.replaceChildren(...rows);
    updateProgress(player.active ? player.tick() : cursor);
  }

  function renderAll() {
    if (!els.view) build();
    els.empty.hidden = !!song;
    els.view.hidden = !song;
    if (!song) { stopPlay(); renderRecent(); return; }
    renderHead(); renderBar(); renderPreview(); renderOpts(); renderDock(); renderParts();
  }

  function renderOut() {
    if (!els.out) return;
    const o = hub.activeOutput;
    els.out.classList.toggle('ok', !!o);
    els.out.textContent = o ? 'Phát qua: ' + (o.name || 'đàn') : 'Chưa nối đàn';
    els.out.title = o ? 'Bài sẽ phát ra loa của đàn. Bấm để đổi cổng.' : 'Cần nối đàn để nghe. Bấm để kết nối.';
  }

  // ---------- Thao tác ----------
  function transpose(d) {
    begin();
    for (const p of song.parts) if (p.channel !== 9) transposeNotes(p.notes, d);
    changed();
  }
  function setTempo(v) {
    if (!(v >= 20 && v <= 300)) { renderBar(); return; }
    begin();
    scaleTempo(song, v);
    changed();
  }
  function removePart(i) {
    if (song.parts.length <= 1) { env.toast('Bài cần ít nhất một phần.'); return; }
    begin();
    const [p] = song.parts.splice(i, 1);
    mix.mute.delete(p.id); mix.solo.delete(p.id); mix.vol.delete(p.id);
    changed();
    env.toast(`Đã xóa phần ${p.name || 'chưa đặt tên'}. Bấm Hoàn tác nếu lỡ tay.`);
  }
  function closeSong() {
    stopPlay();
    song = null;
    env.onSongChange(null);
    undo = []; redo = [];
    renderAll();
  }
  function exportMid() {
    const bytes = writeMidi(song);
    env.download(env.slug(song.title || fileName || 'bai-midi') + '.mid', bytes, 'audio/midi');
  }

  // ---------- Mở file ----------
  function pickFile() {
    const i = h('input', { type: 'file', accept: '.mid,.midi,.kar,audio/midi,audio/x-midi', hidden: true });
    i.addEventListener('change', () => { if (i.files[0]) openFile(i.files[0]); });
    document.body.append(i);
    i.click();
    setTimeout(() => i.remove(), 60000);
  }
  async function openFile(file) {
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('File lớn hơn 8 MB, app không mở được.');
      const s = parseMidi(await file.arrayBuffer());
      env.adopt(s, file.name.replace(/\.(mid|midi|kar)$/i, ''));
    } catch (e) {
      env.toast(e && e.message ? e.message : 'Không đọc được file này.');
    }
  }

  // ---------- Giao diện công khai ----------
  function show(s, name = '') {
    const wasLearning = learn.isOpen();
    learn.close();
    stopPlay();
    song = s;
    fileName = name;
    cursor = 0;
    mix.mute.clear(); mix.solo.clear(); mix.vol.clear();
    undo = []; redo = [];
    renderAll();
    if (s && wasLearning) openLearn(); // đang học mà đổi file thì học luôn bài mới
  }

  build();
  renderAll();

  return {
    show, pickFile, openFile, togglePlay, stop: () => { learn.close(); stopPlay(); }, openLearn, learn, refreshDevice: renderOut, refreshRecent: () => { if (!song) renderRecent(); },
    isPlaying: () => player.active || learn.isRunning(),
    hasSong: () => !!song,
    getSong: () => song,
    undo: () => (learn.isOpen() ? false : doUndo()), redo: () => (learn.isOpen() ? false : doRedo()),
  };
}
