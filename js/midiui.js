// Phòng nhạc MIDI: mở file .mid, nghe, sửa nốt trên piano roll, lấy hợp âm, xuất lại thành bài của mình.
import {
  GM, barBeats, extractChords, freeChannel, newSong, parseMidi, partFromChords, quantizeNotes, scaleTempo,
  serializeSong, makeSong, transposeNotes, writeMidi,
} from './songmidi.js';
import { Player } from './player.js';
import { PART_COLORS, Roll } from './roll.js';
import { createLearn } from './learn.js';

const GRIDS = [
  ['1', 'Nốt đen (1 phách)'],
  ['0.5', 'Móc đơn (1/2 phách)'],
  ['0.25', 'Móc kép (1/4 phách)'],
  ['0.125', 'Móc tam (1/8 phách)'],
  ['0.3333333', 'Tam liên móc đơn'],
];

export function createStudio(env) {
  const { h, hub } = env;
  const root = env.root;
  let song = null;
  let ai = 0;
  const sel = new Set();
  const mix = { mute: new Set(), solo: new Set(), vol: new Map() };
  let gridBeats = 0.25;
  let tool = 'select';
  let cursor = null;
  let loop = false;
  let quantEnds = false;
  let undo = [];
  let redo = [];
  let roll = null;
  let raf = 0;
  let focused = false;
  let fileName = '';
  const els = {};
  const learn = createLearn({ h, hub, toast: (m) => env.toast(m), noteLabel: (n) => env.noteLabel(n), openDevice: () => env.openDevice(), acceptCh: (c) => env.acceptCh(c) });

  const player = new Player({
    hub,
    getMix: () => ({ mute: mix.mute, solo: mix.solo.size ? mix.solo : null, vol: mix.vol }),
    onEnd: () => { renderBar(); stopLoop(); roll && roll.draw(); },
  });

  const gridTicks = () => Math.max(1, Math.round(song.ppq * gridBeats));
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
    renderBar();
  }
  function changed() {
    env.onSongChange(song);
    renderBar();
    renderParts();
    roll && roll.draw();
  }
  function applySnapshot(str) {
    stopPlay();
    song = fromSnapshot(str);
    ai = Math.min(ai, song.parts.length - 1);
    sel.clear();
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
  function startPlay() {
    if (!song) return;
    if (!hub.activeOutput) {
      env.toast('Chưa nối đàn. Bấm Kết nối đàn, chọn cổng MIDI ra là đàn của bạn, rồi phát lại.');
      env.openDevice();
      return;
    }
    env.stopOther();
    player.start(song, cursor ?? 0, { loop });
    startLoop();
    renderBar();
  }
  function stopPlay() {
    if (player.active) player.stop();
    stopLoop();
    renderBar();
    roll && roll.draw();
  }
  function togglePlay() { if (learn.isOpen()) { learn.toggle(); return; } player.active ? stopPlay() : startPlay(); }
  function openLearn() { if (!song) return; stopPlay(); learn.open(song, song.title || fileName); }
  function startLoop() {
    cancelAnimationFrame(raf);
    const f = () => {
      if (!player.active) return;
      const t = player.tick();
      if (els.time) els.time.textContent = tickText(t);
      roll.follow(t);
      roll.draw();
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
  }
  function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

  let warnedNoOut = false;
  function audition(part, pitch) {
    if (pitch < 0 || pitch > 127) return;
    if (!hub.activeOutput) {
      if (!warnedNoOut) { warnedNoOut = true; env.toast('Nối đàn để nghe từng nốt khi bạn bấm hoặc kéo.'); }
      return;
    }
    const ch = part.channel & 15;
    if (part.channel !== 9) hub.send([0xc0 | ch, part.program & 127]);
    hub.send([0x90 | ch, pitch, 90]);
    hub.send([0x80 | ch, pitch, 0], performance.now() + 280);
  }

  // ---------- Dựng giao diện ----------
  const btn = (text, onclick, cls = 'btn-ghost small', extra = {}) => h('button', { type: 'button', class: cls, onclick, text, ...extra });

  function build() {
    root.replaceChildren();
    els.empty = h('div', { class: 'studio-empty' },
      h('p', { class: 'studio-lead', text: 'Mở một bài MIDI, nghe bằng đàn của bạn, sửa từng nốt rồi biến nó thành bài của mình.' }),
      h('p', { class: 'hint', text: 'Kéo thả file .mid vào bất kỳ đâu trên trang, hoặc chọn từ máy. Bài được phát qua cổng MIDI của đàn, nên hãy nối đàn trước. File không gửi đi đâu.' }),
      h('div', { class: 'studio-empty-actions' },
        btn('Mở file MIDI', pickFile, 'btn-primary'),
        btn('Bắt đầu từ bài trống', () => env.adopt(newSong({ bpm: env.getP().bpm, num: env.getP().beats }), 'Bài mới'), 'btn-ghost')));

    els.view = h('div', { class: 'studio-view', hidden: true });
    els.head = h('div', { class: 'studio-head' });
    els.bar = h('div', { class: 'studio-bar', role: 'toolbar', 'aria-label': 'Điều khiển phát và sửa nốt' });
    els.parts = h('div', { class: 'studio-parts', role: 'list', 'aria-label': 'Các phần nhạc cụ' });
    els.canvas = h('canvas', { class: 'roll', 'aria-label': 'Piano roll. Bấm đúp để thêm nốt, kéo để di chuyển, Delete để xóa.' });
    els.foot = h('div', { class: 'studio-foot' });
    els.view.append(els.head, els.bar, h('div', { class: 'studio-main' }, els.parts, h('div', { class: 'roll-wrap' }, els.canvas)), els.foot);
    root.append(els.empty, els.view);

    roll = new Roll(els.canvas, {
      song: () => song,
      partIndex: () => ai,
      sel,
      grid: gridTicks,
      tool: () => tool,
      tick: () => (player.active ? player.tick() : null),
      cursor: () => cursor,
      setCursor: (t) => { cursor = t; if (els.time && !player.active) els.time.textContent = tickText(t); if (player.active) player.setFrom(t); },
      begin, changed,
      audition,
      label: (n) => env.noteLabel(n),
      selChanged: () => { renderBar(); },
    });
    root.addEventListener('pointerdown', () => { focused = true; }, true);
    root.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFull(); }
      if (e.key === 'Escape' && els.view.classList.contains('css-full')) toggleFull();
    });
    document.addEventListener('pointerdown', (e) => { if (!root.contains(e.target)) focused = false; }, true);
  }

  function renderHead() {
    els.head.replaceChildren(
      h('div', { class: 'studio-title' },
        h('b', { text: song.title || fileName || 'Bài MIDI' }),
        h('span', { text: `${song.parts.length} phần, ${song.parts.reduce((a, p) => a + p.notes.length, 0).toLocaleString('vi-VN')} nốt` })),
      h('div', { class: 'studio-head-actions' },
        els.out = h('button', { type: 'button', class: 'out-chip', onclick: () => env.openDevice() }),
        btn('Mở file khác', pickFile, 'btn-ghost'),
        btn('Gỡ khỏi bài này', removeSong, 'btn-ghost danger'),
        btn('Học bài này', openLearn, 'btn-ghost accent', { id: 'btn-learn', title: 'Nốt rơi, đợi bạn chơi đúng từng tay' }),
        btn('Toàn màn hình', toggleFull, 'btn-ghost', { id: 'btn-full', title: 'Phím tắt: F' }),
        btn('Tải file .mid', exportMid, 'btn-primary')));
    renderOut();
  }

  function renderBar() {
    if (!song || !els.bar) return;
    const playing = player.active;
    const bpm = Math.round(song.tempos[0].bpm * 10) / 10;
    const nSel = sel.size;
    const part = song.parts[ai];
    const scope = nSel ? `${nSel} nốt đang chọn` : `cả phần ${part ? part.name || 'này' : ''}`;
    const num = (id, val, min, max, label, on) => {
      const i = h('input', { type: 'number', id, min, max, value: val, 'aria-label': label, inputmode: 'decimal' });
      i.addEventListener('change', () => on(+i.value));
      return i;
    };
    const play = h('button', { type: 'button', class: 'play', 'aria-pressed': String(playing), onclick: togglePlay });
    play.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' + (playing ? '<rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/>' : '<path d="M4 2.5v11l9-5.5z" fill="currentColor"/>') + '</svg><span>' + (playing ? 'Dừng' : 'Phát') + '</span>';
    els.time = h('output', { class: 'studio-time', 'aria-label': 'Vị trí: ô nhịp.phách', text: tickText(playing ? player.tick() : cursor ?? 0) });
    const gridSel = h('select', { 'aria-label': 'Độ chia lưới' }, GRIDS.map(([v, l]) => h('option', { value: v, text: l, selected: Math.abs(+v - gridBeats) < 1e-6 })));
    gridSel.addEventListener('change', () => { gridBeats = +gridSel.value; roll.draw(); });
    const loopBtn = h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(loop), onclick: () => { loop = !loop; renderBar(); if (player.active) player.loop = loop; } }, 'Lặp');
    const toolBtn = (id, label) => h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(tool === id), onclick: () => { tool = id; renderBar(); } }, label);
    const shiftBtn = (label, d, whole) => h('button', { type: 'button', class: 'step wide', 'aria-label': label, title: label, onclick: () => transpose(d, whole) }, d > 0 ? '+' + Math.abs(d) : '−' + Math.abs(d));
    els.bar.replaceChildren(
      h('div', { class: 'sb-group' }, play, els.time,
        btn('Về đầu', () => { cursor = 0; if (player.active) player.setFrom(0); roll.x0 = 0; renderBar(); roll.draw(); }, 'btn-ghost small'), loopBtn),
      h('div', { class: 'sb-group' },
        h('label', { class: 'bpm' }, num('midi-bpm', bpm, 20, 300, 'Tempo', setTempo), h('span', { text: 'BPM' })),
        song.tempos.length > 1 ? h('span', { class: 'hint', text: 'Bài có nhiều tempo, đổi sẽ co giãn đều' }) : null),
      h('div', { class: 'sb-group' }, toolBtn('select', 'Chọn'), toolBtn('draw', 'Vẽ nốt'), h('label', { class: 'sb-lbl' }, h('span', { text: 'Lưới' }), gridSel)),
      h('div', { class: 'sb-group' },
        h('span', { class: 'sb-lbl', text: `Sửa ${scope}:` }),
        btn('Làm tròn nhịp', quantize),
        h('button', { type: 'button', class: 'toggle small', 'aria-pressed': String(quantEnds), title: 'Làm tròn cả độ dài nốt', onclick: () => { quantEnds = !quantEnds; renderBar(); } }, 'cả độ dài'),
        h('span', { class: 'sb-lbl', text: 'Cao độ' }), shiftBtn('Hạ một quãng tám', -12), shiftBtn('Hạ nửa cung', -1), shiftBtn('Nâng nửa cung', 1), shiftBtn('Nâng một quãng tám', 12),
        btn('Xóa', () => roll.del(), 'btn-ghost small danger', { disabled: nSel ? null : true })),
      h('div', { class: 'sb-group' },
        h('span', { class: 'sb-lbl', text: 'Cả bài:' }),
        h('button', { type: 'button', class: 'step wide', 'aria-label': 'Hạ cả bài nửa cung', onclick: () => transpose(-1, true) }, '−1'),
        h('button', { type: 'button', class: 'step wide', 'aria-label': 'Nâng cả bài nửa cung', onclick: () => transpose(1, true) }, '+1'),
        btn('Hoàn tác', () => { doUndo(); }, 'btn-ghost small', { disabled: undo.length ? null : true }),
        btn('Làm lại', () => { doRedo(); }, 'btn-ghost small', { disabled: redo.length ? null : true })));
  }

  function renderParts() {
    if (!song) return;
    const rows = song.parts.map((p, i) => {
      const col = PART_COLORS[i % PART_COLORS.length];
      const drum = p.channel === 9;
      const name = h('input', { class: 'pname', type: 'text', value: p.name, maxlength: 40, 'aria-label': 'Tên phần', placeholder: drum ? 'Trống' : 'Nhạc cụ' });
      name.addEventListener('change', () => { begin(); p.name = name.value.trim(); changed(); });
      const prog = drum ? h('span', { class: 'pprog drum', text: 'Bộ trống' }) : h('select', { class: 'pprog', 'aria-label': 'Âm sắc' }, GM.map((g, k) => h('option', { value: k, text: `${k + 1}. ${g}`, selected: k === p.program })));
      if (!drum) {
        prog.addEventListener('change', () => { begin(); p.program = +prog.value; changed(); });
      }
      const vol = h('input', { type: 'range', min: 0, max: 150, value: Math.round((mix.vol.get(p.id) ?? 1) * 100), 'aria-label': 'Âm lượng phần này', class: 'pvol' });
      vol.addEventListener('input', () => { mix.vol.set(p.id, vol.value / 100); if (player.active) player.volume(p, vol.value / 100); });
      const ms = (key, label, title) => h('button', {
        type: 'button', class: 'ms', 'aria-pressed': String(mix[key].has(p.id)), title, 'aria-label': title,
        onclick: (e) => { e.stopPropagation(); mix[key].has(p.id) ? mix[key].delete(p.id) : mix[key].add(p.id); renderParts(); },
      }, label);
      const del = h('button', { type: 'button', class: 'ms del', title: 'Xóa phần này', 'aria-label': 'Xóa phần này', onclick: (e) => { e.stopPropagation(); removePart(i); } }, '×');
      return h('div', { class: 'part' + (i === ai ? ' on' : ''), role: 'listitem', style: `--pc:${col}`, onclick: () => setActive(i) },
        h('div', { class: 'part-top' }, h('i', { class: 'pdot' }), name, ms('mute', 'M', 'Tắt tiếng'), ms('solo', 'S', 'Chỉ nghe phần này'), del),
        h('div', { class: 'part-bot' }, prog, vol),
        h('div', { class: 'part-meta', text: `Kênh ${p.channel + 1}, ${p.notes.length} nốt` }));
    });
    const hasDrum = song.parts.some((p) => p.channel === 9);
    els.parts.replaceChildren(...rows, h('div', { class: 'part-add' }, btn('+ Nhạc cụ', () => addPart(false)), hasDrum ? null : btn('+ Trống', () => addPart(true))));
  }

  // Đổi phần đang sửa mà không dựng lại danh sách, để ô chọn âm sắc và thanh âm lượng không mất focus.
  function setActive(i) {
    if (i === ai) return;
    ai = i;
    sel.clear();
    [...els.parts.querySelectorAll('.part')].forEach((el, k) => el.classList.toggle('on', k === i));
    renderBar();
    roll.draw();
  }

  function renderFoot() {
    els.foot.replaceChildren(
      h('div', { class: 'foot-block' },
        h('b', { text: 'Từ MIDI sang hợp âm' }),
        h('span', { text: 'Đọc các nốt đang chơi, ghi hợp âm vào bản hợp âm phía trên để bạn chỉnh tiếp.' }),
        btn('Lấy hợp âm vào bản nhạc', openChordsDialog, 'btn-primary small')),
      h('div', { class: 'foot-block' },
        h('b', { text: 'Từ hợp âm sang MIDI' }),
        h('span', { text: 'Biến bản hợp âm của bạn thành một phần đệm mới trong bài này.' }),
        btn('Thêm phần hợp âm', addChordPart, 'btn-ghost small')),
      h('p', { class: 'hint foot-hint', text: 'Phím tắt trong piano roll: Ctrl+A chọn hết, Ctrl+C và Ctrl+V chép, Ctrl+D nhân đôi, phím mũi tên dịch nốt, Shift+mũi tên lên xuống đổi một quãng tám, Delete xóa. Bấm lên thước để đặt chỗ bắt đầu phát.' }));
  }

  function renderAll() {
    if (!els.view) build();
    els.empty.hidden = !!song;
    els.view.hidden = !song;
    if (!song) { stopPlay(); return; }
    renderHead(); renderBar(); renderParts(); renderFoot();
    requestAnimationFrame(() => { roll.resize(); });
  }

  // ---------- Trạng thái đàn và toàn màn hình ----------
  function renderOut() {
    if (!els.out) return;
    const o = hub.activeOutput;
    els.out.classList.toggle('ok', !!o);
    els.out.textContent = o ? 'Phát qua: ' + (o.name || 'đàn') : 'Chưa nối đàn';
    els.out.title = o ? 'Bài sẽ phát ra loa của đàn. Bấm để đổi cổng.' : 'Cần nối đàn để nghe. Bấm để kết nối.';
  }
  const isFull = () => document.fullscreenElement === els.view || els.view.classList.contains('css-full');
  function setFullUi() {
    const on = isFull();
    els.view.classList.toggle('is-full', on);
    const b = document.getElementById('btn-full');
    if (b) b.textContent = on ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    requestAnimationFrame(() => { roll && roll.resize(); });
  }
  async function toggleFull() {
    if (!song) return;
    if (isFull()) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      els.view.classList.remove('css-full');
      setFullUi();
      return;
    }
    try {
      await els.view.requestFullscreen();
    } catch (e) {
      els.view.classList.add('css-full'); // trình duyệt không cho: phóng to trong trang
    }
    setFullUi();
  }
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) els.view.classList.remove('css-full'); setFullUi(); });

  // ---------- Thao tác ----------
  function targetNotes() {
    const p = song.parts[ai];
    if (!p) return [];
    return sel.size ? [...sel] : p.notes;
  }
  function quantize() {
    const p = song.parts[ai];
    if (!p || !p.notes.length) return;
    begin();
    quantizeNotes(targetNotes(), gridTicks(), { ends: quantEnds });
    p.notes.sort((a, b) => a.t - b.t || a.n - b.n);
    changed();
    env.toast('Đã làm tròn nốt theo lưới ' + GRIDS.find(([v]) => Math.abs(+v - gridBeats) < 1e-6)[1].toLowerCase());
  }
  function transpose(d, whole) {
    if (whole) {
      begin();
      for (const p of song.parts) if (p.channel !== 9) transposeNotes(p.notes, d);
      changed();
      return;
    }
    const p = song.parts[ai];
    if (!p) return;
    if (p.channel === 9) { env.toast('Phần trống không đổi cao độ được, mỗi nốt là một loại trống.'); return; }
    begin();
    transposeNotes(targetNotes(), d);
    changed();
  }
  function setTempo(v) {
    if (!(v >= 20 && v <= 300)) { renderBar(); return; }
    begin();
    scaleTempo(song, v);
    changed();
  }
  function addPart(drum) {
    begin();
    const channel = drum ? 9 : freeChannel(song);
    song.parts.push(makeSong({ parts: [{ name: drum ? 'Trống' : 'Nhạc cụ mới', channel, program: 0, notes: [] }] }).parts[0]);
    ai = song.parts.length - 1;
    sel.clear();
    changed();
    roll.fit();
  }
  function removePart(i) {
    if (song.parts.length <= 1) { env.toast('Bài cần ít nhất một phần. Hãy thêm phần mới trước khi xóa.'); return; }
    begin();
    const [p] = song.parts.splice(i, 1);
    mix.mute.delete(p.id); mix.solo.delete(p.id); mix.vol.delete(p.id);
    ai = Math.min(ai, song.parts.length - 1);
    sel.clear();
    changed();
    env.toast(`Đã xóa phần ${p.name || 'chưa đặt tên'}. Bấm Hoàn tác nếu lỡ tay.`);
  }
  function removeSong() {
    if (!els.rm) { els.rm = true; setTimeout(() => { els.rm = false; }, 3000); env.toast('Bấm "Gỡ khỏi bài này" lần nữa để xóa phần MIDI. Hợp âm giữ nguyên.'); return; }
    els.rm = false;
    stopPlay();
    song = null;
    env.onSongChange(null);
    undo = []; redo = [];
    renderAll();
  }
  function addChordPart() {
    const P = env.getP();
    if (!P.events.length) { env.toast('Bản hợp âm đang trống. Ghi hoặc thêm hợp âm trước.'); return; }
    begin();
    const part = partFromChords(P.events, { ppq: song.ppq, beats: barBeats(song), transpose: P.transpose, name: 'Hợp âm của tôi', channel: freeChannel(song), program: 0 });
    song.parts.push(part);
    ai = song.parts.length - 1;
    sel.clear();
    changed();
    roll.fit();
    env.toast('Đã thêm phần "Hợp âm của tôi". Bạn có thể kéo nốt, đổi âm sắc hoặc làm tròn nhịp.');
  }
  function exportMid() {
    const bytes = writeMidi(song);
    env.download(env.slug(env.getP().title || song.title || 'bai-midi') + '.mid', bytes, 'audio/midi');
  }

  // ---------- Hộp thoại lấy hợp âm ----------
  function openChordsDialog() {
    const dlg = document.getElementById('dlg-chords');
    const body = document.getElementById('dlg-chords-body');
    const bb = barBeats(song);
    const checks = song.parts.map((p, i) => {
      const c = h('input', { type: 'checkbox', checked: p.channel !== 9, disabled: p.channel === 9 ? true : null });
      return { p, c, row: h('label', { class: 'chk' }, c, h('i', { class: 'pdot', style: `--pc:${PART_COLORS[i % PART_COLORS.length]}` }), h('span', { text: `${p.name || 'Phần ' + (i + 1)}${p.channel === 9 ? ' (trống, bỏ qua)' : ''}` })) };
    });
    const unit = h('select', { 'aria-label': 'Độ dài mỗi hợp âm' },
      h('option', { value: String(bb), text: 'Mỗi ô nhịp một hợp âm' }),
      bb >= 4 ? h('option', { value: String(bb / 2), text: 'Mỗi nửa ô nhịp' }) : null,
      h('option', { value: '1', text: 'Mỗi phách (dày, dễ nhiễu)' }));
    const level = h('select', { 'aria-label': 'Mức chi tiết' },
      h('option', { value: '0', text: 'Cơ bản: tam hợp âm, hợp âm bảy' }),
      h('option', { value: '1', text: 'Đầy đủ: thêm 9, 11, 13' }));
    const info = h('p', { class: 'hint' });
    const run = () => {
      const ids = checks.filter((x) => x.c.checked).map((x) => x.p.id);
      if (!ids.length) { info.textContent = 'Hãy chọn ít nhất một phần.'; return null; }
      const ev = extractChords(song, { partIds: ids, unitBeats: +unit.value, level: +level.value });
      info.textContent = ev.length ? `Tìm được ${ev.length} lần đổi hợp âm.` : 'Không tìm thấy hợp âm rõ ràng. Thử chọn thêm phần có nhiều nốt đồng thời, như piano hoặc đàn guitar.';
      return ev;
    };
    [unit, level, ...checks.map((x) => x.c)].forEach((e) => e.addEventListener('change', run));
    const go = btn('Lấy hợp âm', () => {
      const ev = run();
      if (!ev || !ev.length) return;
      env.applyChords(ev, { beats: bb });
      dlg.close();
    }, 'btn-primary');
    body.replaceChildren(
      h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Đóng', onclick: () => dlg.close(), text: '×' }),
      h('h3', { text: 'Lấy hợp âm từ MIDI' }),
      h('p', { class: 'sub', text: 'Thay toàn bộ hợp âm trong bản nhạc hiện tại. Bấm Hoàn tác ở phần bản hợp âm nếu muốn quay lại.' }),
      h('div', { class: 'set-block' }, h('b', { text: 'Đọc từ phần nào' }), ...checks.map((x) => x.row)),
      h('div', { class: 'set-block' }, h('b', { text: 'Độ dày' }), unit, level),
      info,
      h('div', { class: 'dlg-actions' }, go));
    run();
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Mở file ----------
  function pickFile() {
    const i = h('input', { type: 'file', accept: '.mid,.midi,audio/midi,audio/x-midi', hidden: true });
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
    stopPlay();
    song = s;
    fileName = name;
    ai = 0;
    sel.clear();
    mix.mute.clear(); mix.solo.clear(); mix.vol.clear();
    undo = []; redo = [];
    cursor = null;
    if (s) {
      // chọn phần có nhiều nốt nhất (không phải trống) để mở ra đầu tiên
      let best = -1, bi = 0;
      s.parts.forEach((p, i) => { const sc = p.channel === 9 ? -1 : p.notes.length; if (sc > best) { best = sc; bi = i; } });
      ai = bi;
    }
    renderAll();
    if (s && roll) requestAnimationFrame(() => roll.fit());
  }

  build();
  renderAll();

  return {
    show, pickFile, openFile, togglePlay, stop: () => { learn.close(); stopPlay(); }, openLearn, learn, refreshDevice: renderOut, toggleFull, isFull: () => !!song && isFull(),
    fullEl: () => els.view,
    isPlaying: () => player.active || learn.isRunning(),
    isFocused: () => focused && !!song,
    hasSong: () => !!song,
    undo: () => (learn.isOpen() ? false : doUndo()), redo: () => (learn.isOpen() ? false : doRedo()),
    scrollIntoView: () => root.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    resize: () => roll && roll.resize(),
  };
}
