// Phòng nhạc MIDI: mở file .mid, nghe qua đàn, chỉnh âm sắc, âm lượng từng phần, đổi tông, tải lại, và học bài.
import {
  GM, barBeats, makeSong, parseMidi, scaleTempo, serializeSong, songEnd, transposeNotes, writeMidi,
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
  const learn = createLearn({ h, hub, toast: (m) => env.toast(m), noteLabel: (n) => env.noteLabel(n), openDevice: () => env.openDevice(), acceptCh: (c) => env.acceptCh(c), pickFile: () => pickFile() });

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
  const tickText = (t) => {
    const bb = barBeats(song);
    const beats = t / song.ppq;
    const bar = Math.floor(beats / bb + 1e-9);
    const beat = Math.floor(beats - bar * bb + 1e-9);
    return `${bar + 1}.${beat + 1}`;
  };
  const endTick = () => Math.max(1, songEnd(song));
  function updateProgress(t) {
    if (!song || !els.time) return;
    els.time.textContent = tickText(t);
    if (els.seek) els.seek.value = String(Math.round(t));
    const pct = Math.min(100, (t / endTick()) * 100) + '%';
    els.parts.querySelectorAll('.ph').forEach((e) => { e.style.left = pct; });
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
        h('p', { class: 'studio-lead', text: 'Mở một bài MIDI, nghe qua đàn và học với nốt rơi.' }),
        h('p', { class: 'hint', text: 'Kéo thả file .mid vào bất kỳ đâu trên trang, hoặc chọn từ máy. Bài được phát qua cổng MIDI của đàn, nên hãy nối đàn trước. File không gửi đi đâu.' }),
        h('div', { class: 'studio-empty-actions' }, btn('Mở file MIDI', pickFile, 'btn-primary big')),
        h('ol', { class: 'steps' },
          h('li', {}, h('b', { text: 'Nối đàn. ' }), 'Cắm cáp vào cổng USB TO HOST rồi bật đàn.'),
          h('li', {}, h('b', { text: 'Mở bài. ' }), 'Chọn file .mid, chỉnh âm sắc và âm lượng từng phần.'),
          h('li', {}, h('b', { text: 'Học bài. ' }), 'Nốt rơi xuống phím đàn, chơi đúng nhịp để ghi điểm.'))),
      els.recent = h('div', { class: 'recent' }));

    els.view = h('div', { class: 'studio-view', hidden: true });
    els.head = h('div', { class: 'studio-head' });
    els.bar = h('div', { class: 'studio-bar', role: 'toolbar', 'aria-label': 'Điều khiển phát' });
    els.parts = h('div', { class: 'studio-parts', role: 'list', 'aria-label': 'Các phần nhạc cụ' });
    els.view.append(els.head, els.bar, els.parts);
    root.append(els.empty, els.view);
  }

  function renderRecent() {
    const list = env.recent().slice(0, 8);
    els.recent.replaceChildren(h('b', { text: 'Bài gần đây' }), ...(list.length ? list.map((s) =>
      h('button', { type: 'button', class: 'recent-item', onclick: () => env.openSaved(s.id) },
        h('span', { text: s.title || 'Bài chưa đặt tên' }), h('i', { text: `${s.parts} phần, ${s.notes.toLocaleString('vi-VN')} nốt` }))) : [h('p', { class: 'hint', text: 'Bài bạn mở sẽ hiện ở đây, lần sau bấm là vào ngay.' })]));
  }

  function renderHead() {
    const title = h('input', { class: 'studio-name', type: 'text', value: song.title || fileName || '', placeholder: 'Đặt tên bài', maxlength: 80, 'aria-label': 'Tên bài', autocomplete: 'off' });
    title.addEventListener('change', () => { song.title = title.value.trim(); env.onSongChange(song); });
    els.head.replaceChildren(
      h('div', { class: 'studio-title' }, title,
        h('span', { text: `${song.parts.length} phần, ${song.parts.reduce((a, p) => a + p.notes.length, 0).toLocaleString('vi-VN')} nốt` })),
      h('div', { class: 'studio-head-actions' },
        els.out = h('button', { type: 'button', class: 'out-chip', onclick: () => env.openDevice() }),
        btn('Mở file khác', pickFile, 'btn-ghost'),
        btn('Đóng bài', closeSong, 'btn-ghost', { title: 'Bài vẫn được lưu trong Bản nhạc của tôi' }),
        btn('Học bài này', openLearn, 'btn-primary', { id: 'btn-learn', title: 'Nốt rơi, đợi bạn chơi đúng từng tay' }),
        btn('Tải file .mid', exportMid, 'btn-ghost')));
    renderOut();
  }

  function renderBar() {
    if (!song || !els.bar) return;
    const playing = player.active;
    const bpm = Math.round(song.tempos[0].bpm * 10) / 10;
    const bpmIn = h('input', { type: 'number', id: 'midi-bpm', min: 20, max: 300, value: bpm, 'aria-label': 'Tempo', inputmode: 'decimal' });
    bpmIn.addEventListener('change', () => setTempo(+bpmIn.value));
    const play = h('button', { type: 'button', class: 'play', 'aria-pressed': String(playing), onclick: togglePlay });
    play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' + (playing ? '<rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>' : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>') + '</svg><span>' + (playing ? 'Dừng' : 'Phát') + '</span>';
    els.time = h('output', { class: 'studio-time', 'aria-label': 'Vị trí: ô nhịp.phách', text: tickText(playing ? player.tick() : cursor) });
    els.seek = h('input', { type: 'range', class: 'studio-seek', min: 0, max: endTick(), step: 1, value: Math.round(playing ? player.tick() : cursor), 'aria-label': 'Vị trí trong bài' });
    els.seek.addEventListener('input', () => {
      cursor = +els.seek.value;
      if (player.active) player.setFrom(cursor);
      updateProgress(cursor);
    });
    const loopBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(loop), onclick: () => { loop = !loop; renderBar(); if (player.active) player.loop = loop; } }, 'Lặp');
    const shift = (label, d, text) => h('button', { type: 'button', class: 'step wide', 'aria-label': label, title: label, onclick: () => transpose(d) }, text);
    els.bar.replaceChildren(
      h('div', { class: 'sb-group' }, play, els.time, btn('Về đầu', () => { cursor = 0; if (player.active) player.setFrom(0); updateProgress(0); }), loopBtn),
      els.seek,
      h('div', { class: 'sb-group' },
        h('label', { class: 'bpm' }, bpmIn, h('span', { text: 'BPM' })),
        song.tempos.length > 1 ? h('span', { class: 'hint', text: 'Bài có nhiều tempo, đổi sẽ co giãn đều' }) : null),
      h('div', { class: 'sb-group' },
        h('span', { class: 'sb-lbl', text: 'Đổi tông cả bài' }),
        shift('Hạ một quãng tám', -12, '−12'), shift('Hạ nửa cung', -1, '−1'), shift('Nâng nửa cung', 1, '+1'), shift('Nâng một quãng tám', 12, '+12'),
        btn('Hoàn tác', () => { doUndo(); }, 'btn-ghost small', { disabled: undo.length ? null : true }),
        btn('Làm lại', () => { doRedo(); }, 'btn-ghost small', { disabled: redo.length ? null : true })));
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
    renderHead(); renderBar(); renderParts();
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
