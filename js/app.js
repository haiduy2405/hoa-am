import {
  detect, chordParts, chordText, chordKey, sameChord, transposeChord, parseChord, detectKey, keyName, keySpelling, autoFlat,
  roman, inKey, suggestNext, voiceChord, noteName, QUICK_TYPES, TYPES,
} from './engine.js';
import { barChords, chordAtBeat, newProject, sortedEvents, totalBars, uid, weightedChords } from './model.js';
import { MidiHub } from './midi.js';
import { Synth } from './audio.js';
import { buildKeyboard, rangeFor } from './keyboard.js';
import { buildMidi, download, projectToText, slug } from './export.js';
import { DEFAULTS, deleteProject, loadCurrent, loadLibrary, loadSettings, normalizeProject, saveProject, saveSettings } from './store.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mod12 = (n) => ((n % 12) + 12) % 12;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
}

// ======================= Trạng thái =======================
const S = loadSettings();
let P = normalizeProject(loadCurrent() || newProject());
const hub = new MidiHub();
const synth = new Synth();
synth.setVolume(S.volume);

const live = {
  held: new Map(), sustained: new Set(), pedal: false, result: null, chord: null, ghost: false, prevCount: 0,
  altIdx: 0, timer: 0, pend: null, pendTimer: 0, everPlayed: false,
};
const clock = { mode: 'idle', timer: 0, startPerf: 0, beat0: 0, nextClick: 0, items: [], ptr: 0, from: 0, end: 0, t0: 0, raf: 0, lastRow: -1 };
let selId = null;
let keyCache = null;
let kbd = null;
let barEls = [];
const undoStack = [];
const redoStack = [];

const saveSettingsSoon = () => saveSettings(S);
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    P.updated = Date.now();
    saveProject(P);
  }, 250);
}

// ======================= Tông, cách viết =======================
function refreshKey() {
  const w = weightedChords(P);
  keyCache = w.length ? detectKey(w) : null;
}

function activeKey() {
  if (P.keyOverride) return { ...P.keyOverride, auto: false };
  if (!keyCache) return null;
  return { tonic: keyCache.tonic, mode: keyCache.mode, auto: true, confidence: keyCache.confidence, alt: keyCache.alt };
}

// chord đã ở cao độ hiển thị
function flatFor(chordShown, shift) {
  if (S.flatPref === 'flat') return true;
  if (S.flatPref === 'sharp') return false;
  const k = activeKey();
  if (k) {
    const sp = keySpelling({ tonic: mod12(k.tonic + shift), mode: k.mode });
    if (sp != null) return sp;
  }
  return autoFlat(chordShown);
}

const partsLive = (c) => chordParts(c, { flat: flatFor(c, 0) });
const partsSheet = (c) => chordParts(c, { flat: flatFor(transposeChord(c, P.transpose), P.transpose), transpose: P.transpose });
const textSheet = (c) => {
  const p = partsSheet(c);
  return p.root + p.suffix + (p.bass ? '/' + p.bass : '');
};

// 'm' (thứ) nằm ngang cạnh chữ gốc; phần mở rộng (7, maj7, sus4...) nâng lên thành chỉ số trên.
const splitSuffix = (sfx) => (/^m(?!aj)/.test(sfx) ? ['m', sfx.slice(1)] : ['', sfx]);

function chordNode(parts, cls = '') {
  const d = h('span', { class: cls });
  d.append(parts.root);
  const [q, rest] = splitSuffix(parts.suffix);
  if (q) d.append(q);
  if (rest) d.append(h('sup', { text: rest }));
  if (parts.bass) d.append(h('span', { class: 'sl', text: '/' + parts.bass }));
  return d;
}

function romanNode(r) {
  if (!r) return null;
  const s = h('span', { text: r.base });
  if (r.suffix) s.append(h('sup', { text: r.suffix }));
  return s;
}

// Yamaha gọi phím giữa (MIDI 60) là C3, chuẩn quốc tế gọi là C4.
const octOf = (n) => Math.floor(n / 12) - (S.octave === 'intl' ? 1 : 2);

function noteLabel(n, flat) {
  return noteName(n % 12, { flat, solfege: S.solfege }) + octOf(n);
}

// ======================= Phát ra âm thanh =======================
function outNote(on, n, vel, ts) {
  if (S.output === 'midi' && hub.activeOutput) on ? hub.noteOn(n, vel, 1, ts) : hub.noteOff(n, 1, ts);
  else on ? synth.noteOn(n, vel, ts) : synth.noteOff(n, ts);
}

function panicOut() {
  synth.panic();
  if (hub.activeOutput) hub.allOff(1);
}

function audition(chord, ms = 1100) {
  const notes = voiceChord(chord);
  const t = performance.now() + 20;
  notes.forEach((n) => {
    outNote(true, n, 84, t);
    outNote(false, n, 0, t + ms);
  });
}

// ======================= Toast =======================
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ======================= Nhận nốt =======================
const pipHit = new Map();
function flashPip(ch) {
  const i = $$('#pips i')[ch - 1];
  if (i) {
    i.classList.add('hit');
    clearTimeout(pipHit.get(ch));
    pipHit.set(ch, setTimeout(() => i.classList.remove('hit'), 220));
  }
  const b = $(`#dlg-channels-body [data-ch="${ch}"]`);
  if (b) {
    b.classList.add('hit');
    setTimeout(() => b.classList.remove('hit'), 220);
  }
}

function onMidiNote({ on, note, vel, ch }) {
  flashPip(ch);
  if (!S.channels.includes(ch)) return;
  if (on) {
    live.held.set(note, { vel, ch });
    live.sustained.delete(note);
    live.everPlayed = true;
    scheduleAnalyze(35);
  } else {
    if (live.pedal && S.pedal) live.sustained.add(note);
    else live.held.delete(note);
    scheduleAnalyze(90);
  }
}

function virtualOn(n) {
  if (live.held.has(n)) return;
  live.held.set(n, { vel: 88, ch: 1, virtual: true });
  live.everPlayed = true;
  outNote(true, n, 88);
  scheduleAnalyze(25);
}
function virtualOff(n) {
  const v = live.held.get(n);
  if (!v || !v.virtual) return;
  live.held.delete(n);
  outNote(false, n, 0);
  scheduleAnalyze(70);
}

function scheduleAnalyze(delay) {
  clearTimeout(live.timer);
  live.timer = setTimeout(analyze, delay);
}

const heldNotes = () => [...new Set([...live.held.keys(), ...live.sustained])];

function analyze() {
  const notes = heldNotes();
  if (!notes.length) {
    live.prevCount = 0;
    if (live.chord || live.result) {
      if (S.ghost) live.ghost = true;
      else {
        live.result = null;
        live.chord = null;
      }
    }
    renderLive();
    renderSuggest();
    return;
  }
  const shrinking = notes.length < live.prevCount;
  live.prevCount = notes.length;
  const res = detect(notes, { level: S.level });
  if (shrinking && live.chord && res.kind !== 'chord' && res.kind !== 'power') {
    renderLive(); // đang nhả dần các ngón, giữ nguyên hợp âm vừa nhận
    return;
  }
  live.ghost = false;
  live.result = res;
  live.altIdx = 0;
  live.chord = res.candidates[0] || null;
  renderLive();
  renderSuggest();
  considerRecord();
}

function currentChord() {
  const r = live.result;
  if (!r || !r.candidates.length) return null;
  return r.candidates[Math.min(live.altIdx, r.candidates.length - 1)];
}

// ======================= Hiển thị hợp âm đang chơi =======================
function deviceHint() {
  if (hub.status === 'unsupported') return 'Trình duyệt này chưa hỗ trợ MIDI. Hãy mở bằng Chrome hoặc Edge.';
  if (hub.status === 'denied') return 'Trình duyệt đang chặn MIDI. Cấp quyền cho trang này rồi tải lại.';
  if (hub.status === 'ready' && !hub.activeInput) return 'Chưa thấy đàn. Cắm USB, bấm Kết nối đàn, hoặc chơi thử trên phím bên dưới.';
  return null;
}

function renderLive() {
  const box = $('#chord-live');
  const r = live.result;
  const c = currentChord();
  const flat = c ? flatFor(c, 0) : false;
  let sig;
  const build = () => {
    const wrap = h('span', { class: 'swap' });
    if (c) {
      const p = partsLive(c);
      wrap.append(h('span', { class: 'root', text: p.root }));
      const [q, rest] = splitSuffix(p.suffix);
      if (q) wrap.append(h('span', { class: 'q', text: q }));
      if (rest) wrap.append(h('span', { class: 'suf', text: rest }));
      if (p.bass) wrap.append(h('span', { class: 'slash', text: '/' }), h('span', { class: 'bass', text: p.bass }));
      return wrap;
    }
    if (r && r.kind === 'single') {
      wrap.append(h('span', { class: 'root', text: noteName(r.notes[0] % 12, { flat: false }) }));
      return wrap;
    }
    const q = h('span', { class: 'quiet' });
    if (r && r.kind === 'dyad') q.append('Mới hai nốt. Thêm nốt thứ ba để ra hợp âm.');
    else if (r && r.kind === 'cluster') q.append('Cụm nốt này chưa thành hợp âm quen thuộc. Thử bỏ bớt nốt.');
    else {
      const hint = deviceHint();
      if (hint) q.append(hint);
      else q.append('Chơi một hợp âm, tên nó hiện ', h('em', { text: 'ở đây' }), '.');
    }
    wrap.append(q);
    return wrap;
  };
  sig = c ? chordKey(c) : r ? r.kind + (r.kind === 'single' ? r.notes[0] : '') : 'idle' + (deviceHint() || '');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(build());
  }
  box.classList.toggle('ghost', live.ghost);
  paintKeyboard();

  // Dòng nốt
  const ro = $('#notes-readout');
  if (r && r.notes.length && !live.ghost) ro.textContent = r.notes.map((n) => noteLabel(n, flat)).join('  ');
  else if (live.ghost && r) ro.textContent = 'Hợp âm vừa chơi, đang giữ lại';
  else ro.textContent = '';
  $('#btn-notes-mode').textContent = S.solfege ? 'Đang gọi nốt: Đô Rê Mi' : 'Đang gọi nốt: C D E';
  $('#btn-capture').disabled = !c;

  // Cách đọc khác
  const list = $('#alt-list');
  list.replaceChildren();
  if (!r || !r.candidates.length) {
    list.append(h('li', {}, h('p', { class: 'empty-line', text: r && r.notes.length ? 'Chưa có cách đọc nào khớp.' : 'Khi nhiều hợp âm cùng khớp, các cách đọc sẽ nằm ở đây.' })));
  } else {
    const top = r.candidates[0].score;
    r.candidates.forEach((cand, i) => {
      const p = partsLive(cand);
      const pct = Math.max(10, Math.round((cand.score / top) * 100));
      list.append(
        h('li', {},
          h('button', {
            type: 'button', 'aria-current': i === live.altIdx ? 'true' : 'false', title: 'Dùng cách đọc này',
            onclick: () => { live.altIdx = i; live.ghost = false; renderLive(); renderSuggest(); considerRecord(true); },
          },
          chordNode(p, 'alt-chord'),
          h('span', { class: 'alt-bar' }, h('i', { style: `width:${pct}%` })))),
      );
    });
  }
  renderAnalysis();
}

function renderAnalysis() {
  const box = $('#analysis');
  box.replaceChildren();
  const c = currentChord() || (live.ghost ? live.chord : null);
  const k = activeKey();
  if (!k) {
    box.append(h('p', { class: 'empty-line', text: 'Chưa biết tông. Ghi vài hợp âm hoặc chọn tông ở bản nhạc bên dưới.' }));
    return;
  }
  if (!c) {
    box.append(h('p', { class: 'empty-line', text: `Đang xét theo tông ${keyName(k)}. Chơi một hợp âm để xem bậc của nó.` }));
    return;
  }
  const r = roman(c, k);
  const inside = inKey(c, k);
  box.append(
    h('div', { class: 'big' }, romanNode(r)),
    h('div', {}, h('span', { class: 'tag ' + (inside ? 'in' : 'out'), text: inside ? 'Thuộc tông' : 'Ngoài tông, màu mượn' })),
    h('div', { text: `Trong tông ${keyName(k)}${k.auto ? ' (đoán)' : ''}` }),
  );
}

// ======================= Gợi ý hợp âm tiếp theo =======================
function renderSuggest() {
  const box = $('#suggest-list');
  const hint = $('#suggest-hint');
  box.replaceChildren();
  const k = activeKey();
  if (!k) {
    hint.textContent = 'Ghi hoặc thêm vài hợp âm, Hòa Âm sẽ đoán tông rồi gợi ý bước kế tiếp.';
    return;
  }
  const evs = sortedEvents(P);
  const last = live.chord || (evs.length ? evs[evs.length - 1].chord : null);
  const list = suggestNext(last, k, { sevenths: S.level === 1 });
  if (!list.length) {
    hint.textContent = '';
    return;
  }
  const lastTxt = last ? textSheetRaw(last) : null;
  hint.textContent = `${lastTxt ? 'Sau ' + lastTxt + ', t' : 'T'}rong tông ${keyName(k)}. Bấm để nghe, bấm dấu cộng để thêm vào bản nhạc.`;
  for (const s of list) {
    const p = partsLive(s.chord);
    box.append(
      h('div', { class: 'sug ' + (s.tag === 'color' ? 'color' : ''), title: s.reason },
        h('button', { type: 'button', class: 'sug-main', onclick: () => audition(s.chord) },
          chordNode(p, 'sug-chord'),
          h('div', { class: 'sug-roman' }, romanNode(s.roman) || ''),
          h('span', { class: 'sr', text: s.reason })),
        h('button', { type: 'button', class: 'sug-add', 'aria-label': 'Thêm ' + p.root + p.suffix + ' vào bản nhạc', onclick: () => appendChord(s.chord) }, '+')),
    );
  }
}

function textSheetRaw(c) {
  const p = partsLive(c);
  return p.root + p.suffix + (p.bass ? '/' + p.bass : '');
}

// ======================= Sửa bản nhạc (có hoàn tác) =======================
function snap() {
  undoStack.push(JSON.stringify({ events: P.events, rows: P.rows, bars: P.bars }));
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function restore(json) {
  const d = JSON.parse(json);
  P.events = d.events;
  P.rows = d.rows;
  P.bars = d.bars;
  afterEdit();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify({ events: P.events, rows: P.rows, bars: P.bars }));
  restore(undoStack.pop());
  updateUndoButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify({ events: P.events, rows: P.rows, bars: P.bars }));
  restore(redoStack.pop());
  updateUndoButtons();
}
function updateUndoButtons() {
  $('#btn-undo').disabled = !undoStack.length;
  $('#btn-redo').disabled = !redoStack.length;
}

function afterEdit() {
  refreshKey();
  renderKeyUI();
  renderSheet();
  renderAnalysis();
  renderSuggest();
  save();
}

function placeEvent(chord, beat, id) {
  const at = P.events.find((e) => Math.abs(e.beat - beat) < 1e-6 && e.id !== id);
  if (at) P.events.splice(P.events.indexOf(at), 1);
  if (id) {
    const ev = P.events.find((e) => e.id === id);
    if (ev) {
      ev.chord = chord;
      ev.beat = beat;
      return ev;
    }
  }
  const ev = { id: uid(), beat, chord };
  P.events.push(ev);
  return ev;
}

function addEvent(chord, beat) {
  snap();
  const ev = placeEvent({ ...chord }, beat);
  selId = ev.id;
  afterEdit();
  return ev;
}
function updateEvent(id, chord, beat) {
  snap();
  placeEvent({ ...chord }, beat, id);
  afterEdit();
}
function removeEvent(id) {
  snap();
  P.events = P.events.filter((e) => e.id !== id);
  if (selId === id) selId = null;
  afterEdit();
}

function nextFreeBeat() {
  const evs = sortedEvents(P);
  if (!evs.length) return 0;
  const lastBeat = evs[evs.length - 1].beat;
  return (Math.floor(lastBeat / P.beats + 1e-6) + 1) * P.beats;
}

function appendChord(chord) {
  const beat = nextFreeBeat();
  addEvent(chord, beat);
  toast(`Đã thêm ${textSheet(chord)} vào ô nhịp ${beat / P.beats + 1}`);
  const el = barEls[beat / P.beats];
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ======================= Vẽ bản hợp âm =======================
function renderSheet() {
  const per = S.perRow;
  const bars = totalBars(P, per);
  const rows = bars / per;
  const sheet = $('#sheet');
  const k = activeKey();
  barEls = [];
  const frag = document.createDocumentFragment();
  for (let r = 0; r < rows; r++) {
    const meta = P.rows[r] || {};
    const label = h('input', {
      class: 'row-label', type: 'text', placeholder: 'Tên đoạn', 'aria-label': `Tên đoạn của hàng ${r + 1}`, maxlength: 40,
    });
    label.value = meta.label || '';
    label.addEventListener('focus', () => snapOnce());
    label.addEventListener('input', () => { (P.rows[r] ||= {}).label = label.value; save(); });
    const barsEl = h('div', { class: 'bars', style: `--per:${per}` });
    for (let b = 0; b < per; b++) {
      const i = r * per + b;
      const { chords, carry } = barChords(P, i);
      const el = h('div', {
        class: 'bar', 'data-bar': i, role: 'button', tabindex: 0, 'aria-label': `Ô nhịp ${i + 1}`, style: `--cols:${P.beats * 4}`,
      });
      if (carry) el.append(h('div', { class: 'bar-carry', style: `grid-column: 1 / span ${Math.max(1, Math.round(carry.span * 4))}`, text: '%', title: 'Giữ hợp âm ở ô trước' }));
      for (const c of chords) {
        const shown = transposeChord(c.ev.chord, P.transpose);
        const r2 = k && S.roman ? roman(c.ev.chord, k) : null;
        const inside = k ? inKey(c.ev.chord, k) : true;
        const chip = h('button', {
          type: 'button', class: 'chip' + (k && S.roman ? (inside ? ' in' : ' out') : ''), 'data-id': c.ev.id,
          'aria-selected': c.ev.id === selId ? 'true' : 'false',
          style: `grid-column: ${Math.round(c.start * 4) + 1} / span ${Math.max(2, Math.round(c.span * 4))}`,
          'aria-label': `Hợp âm ${textSheet(c.ev.chord)}, phách ${c.start + 1} của ô ${i + 1}`,
        }, chordNode(partsSheet(c.ev.chord), 'chip-chord'));
        if (r2) chip.append(h('div', { class: 'chip-roman' }, romanNode(r2)));
        el.append(chip);
      }
      if (!chords.length && !carry) el.append(h('span', { class: 'bar-empty', 'aria-hidden': 'true', text: '+' }));
      barEls[i] = el;
      barsEl.append(el);
    }
    const lyrics = h('textarea', { class: 'lyrics', rows: 1, placeholder: `Lời cho ${per} ô nhịp này`, 'aria-label': `Lời của hàng ${r + 1}` });
    lyrics.value = meta.lyrics || '';
    const fit = () => { lyrics.style.height = 'auto'; lyrics.style.height = lyrics.scrollHeight + 'px'; };
    lyrics.addEventListener('focus', () => snapOnce());
    lyrics.addEventListener('input', () => { (P.rows[r] ||= {}).lyrics = lyrics.value; fit(); save(); });
    frag.append(
      h('div', { class: 'row', 'data-row': r },
        h('div', { class: 'row-side' }, h('span', { class: 'row-no', text: `Ô ${r * per + 1}–${r * per + per}` }), label),
        barsEl, lyrics),
    );
    requestAnimationFrame(fit);
  }
  sheet.replaceChildren(frag);
}

let snapped = false;
function snapOnce() {
  if (snapped) return;
  snapped = true;
  snap();
  setTimeout(() => { snapped = false; }, 4000);
}

// ======================= Khung sửa hợp âm =======================
let ed = null;
function closeEditor() {
  $('#editor').hidden = true;
  ed = null;
  document.removeEventListener('pointerdown', outsideEditor, true);
}
function outsideEditor(e) {
  const box = $('#editor');
  if (!box.contains(e.target)) closeEditor();
}

function openEditor({ id = null, beat, anchor }) {
  closeEditor();
  const T = P.transpose;
  const ev = id ? P.events.find((e) => e.id === id) : null;
  const k = activeKey();
  let chord;
  if (ev) chord = transposeChord(ev.chord, T);
  else if (live.chord) chord = transposeChord(live.chord, T);
  else if (k) chord = transposeChord({ root: k.tonic, type: k.mode === 'minor' ? 'min' : 'maj', bass: null }, T);
  else chord = { root: 0, type: 'maj', bass: null };
  ed = { id, chord: { ...chord }, beat: ev ? ev.beat : beat };
  const box = $('#editor');
  const spell = (c) => flatFor(c, T);
  const fmtText = () => {
    const p = chordParts(ed.chord, { flat: spell(ed.chord) });
    return p.root + p.suffix + (p.bass ? '/' + p.bass : '');
  };

  const input = h('input', { class: 'ed-input', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Tên hợp âm' });
  const hintEl = h('div', { class: 'ed-hint', text: 'Gõ tên hợp âm, ví dụ Am7, F#m7♭5, C/E, hoặc chọn bên dưới.' });
  const rootGrid = h('div', { class: 'ed-grid', role: 'group', 'aria-label': 'Nốt gốc' });
  const typeGrid = h('div', { class: 'ed-grid types', role: 'group', 'aria-label': 'Loại hợp âm' });
  const bassSel = h('select', { 'aria-label': 'Nốt bass' }, h('option', { value: '', text: 'Bass: mặc định' }),
    ...Array.from({ length: 12 }, (_, i) => h('option', { value: i, text: 'Bass: ' + noteName(i, { flat: spell({ root: i, type: 'maj' }) }) })));
  const beatSel = h('select', { 'aria-label': 'Vào ở phách' });
  const inBar = ((ed.beat % P.beats) + P.beats) % P.beats;
  for (let i = 0; i < P.beats; i++) beatSel.append(h('option', { value: i, text: 'Phách ' + (i + 1) }));
  if (!Number.isInteger(inBar)) beatSel.append(h('option', { value: inBar, text: 'Phách ' + (inBar + 1).toFixed(2) }));
  beatSel.value = String(inBar);

  const sync = (fromInput) => {
    if (!fromInput) input.value = fmtText();
    input.classList.remove('bad');
    $$('button', rootGrid).forEach((b, i) => b.setAttribute('aria-pressed', String(i === ed.chord.root)));
    $$('button', typeGrid).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === ed.chord.type)));
    bassSel.value = ed.chord.bass == null ? '' : String(ed.chord.bass);
    hintEl.textContent = 'Đọc là: ' + fmtText();
  };
  for (let i = 0; i < 12; i++) {
    rootGrid.append(h('button', { type: 'button', text: noteName(i, { flat: spell({ root: i, type: 'maj' }) }), onclick: () => { ed.chord.root = i; if (ed.chord.bass === i) ed.chord.bass = null; sync(); } }));
  }
  const TYPE_LABEL = { maj: 'Trưởng', min: 'Thứ', dom7: '7', maj7: 'maj7', m7: 'm7', sus4: 'sus4', sus2: 'sus2', dim: 'dim', aug: 'aug', six: '6', add9: 'add9', m7b5: 'm7♭5' };
  for (const t of QUICK_TYPES) typeGrid.append(h('button', { type: 'button', 'data-type': t, text: TYPE_LABEL[t] || TYPES[t].suffix, onclick: () => { ed.chord.type = t; sync(); } }));
  input.addEventListener('input', () => {
    const c = parseChord(input.value);
    if (c) { ed.chord = c; sync(true); } else { input.classList.add('bad'); hintEl.textContent = 'Chưa đọc được tên này.'; }
  });
  bassSel.addEventListener('change', () => { ed.chord.bass = bassSel.value === '' ? null : +bassSel.value; if (ed.chord.bass === ed.chord.root) ed.chord.bass = null; sync(); });

  const apply = () => {
    const stored = transposeChord(ed.chord, -T);
    const bar = Math.floor(ed.beat / P.beats + 1e-6);
    const at = bar * P.beats + +beatSel.value;
    const useBeat = ev && Math.abs(inBar - +beatSel.value) < 1e-6 ? ed.beat : at;
    if (ev) updateEvent(ev.id, stored, useBeat);
    else { addEvent(stored, useBeat); }
    closeEditor();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); apply(); }
  });
  box.onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeEditor(); } };

  box.replaceChildren(
    h('div', { class: 'ed-top' }, input),
    hintEl, rootGrid, typeGrid,
    h('div', { class: 'ed-row' }, bassSel, beatSel),
    h('div', { class: 'ed-row' },
      h('div', { class: 'group' },
        h('button', { type: 'button', class: 'btn-quiet small', text: 'Nghe thử', onclick: () => audition(transposeChord(ed.chord, -T)) }),
        ev ? h('button', { type: 'button', class: 'btn-quiet small danger', text: 'Xóa', onclick: () => { removeEvent(ev.id); closeEditor(); } }) : null),
      h('div', { class: 'group' },
        h('button', { type: 'button', class: 'btn-quiet small', text: 'Hủy', onclick: closeEditor }),
        h('button', { type: 'button', class: 'btn-primary', text: ev ? 'Lưu' : 'Thêm vào ô nhịp', onclick: apply }))),
  );
  sync();
  box.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  let left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
  box.style.left = left + 'px';
  const hgt = box.offsetHeight;
  let top = r.bottom + 8;
  if (top + hgt > window.innerHeight - 12) top = Math.max(12, r.top - hgt - 8);
  box.style.top = top + 'px';
  setTimeout(() => document.addEventListener('pointerdown', outsideEditor, true), 0);
  input.focus();
  input.select();
}

$('#sheet').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  const bar = e.target.closest('.bar');
  if (!bar) return;
  if (chip) {
    selId = chip.dataset.id;
    $$('.chip', $('#sheet')).forEach((c) => c.setAttribute('aria-selected', String(c.dataset.id === selId)));
    openEditor({ id: selId, beat: 0, anchor: chip });
  } else {
    openEditor({ beat: +bar.dataset.bar * P.beats, anchor: bar });
  }
});
$('#sheet').addEventListener('keydown', (e) => {
  const bar = e.target.closest && e.target.closest('.bar');
  if (bar && e.target === bar && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openEditor({ beat: +bar.dataset.bar * P.beats, anchor: bar });
  }
});

// ======================= Ghi âm hợp âm =======================
const beatMs = () => 60000 / P.bpm;
function quantStep() {
  if (S.quant === 'half') return P.beats / 2;
  if (S.quant === 'bar') return P.beats;
  return +S.quant || 1;
}

function considerRecord(force) {
  if (clock.mode !== 'armed' && clock.mode !== 'rec') return;
  if (live.ghost) return;
  const c = currentChord();
  const r = live.result;
  if (!c || !r || (r.kind !== 'power' && r.pcs.length < 3)) return;
  const key = chordKey(c);
  if (!force && live.pend && live.pend.key === key) return;
  live.pend = { key, chord: { root: c.root, type: c.type, bass: c.bass }, at: performance.now() - 40 };
  clearTimeout(live.pendTimer);
  live.pendTimer = setTimeout(commitPending, 110);
}

function commitPending() {
  const p = live.pend;
  const c = currentChord();
  if (!p || !c || chordKey(c) !== p.key) return;
  if (clock.mode === 'armed') {
    clock.t0 = p.at;
    clock.mode = 'rec';
    renderTransport();
    startPlayheadLoop();
  }
  if (clock.mode !== 'rec') return;
  const raw = (p.at - clock.t0) / beatMs();
  const q = quantStep();
  const beat = Math.max(0, Math.round(raw / q) * q);
  const evs = sortedEvents(P);
  const before = evs.filter((e) => e.beat <= beat + 1e-6).pop();
  if (before && sameChord(before.chord, p.chord)) return;
  placeEvent(p.chord, beat);
  refreshKey();
  renderKeyUI();
  renderSheet();
  renderSuggest();
  save();
}

// ======================= Đồng hồ: metronome, phát lại, ghi =======================
function startClock(beat0) {
  clearInterval(clock.timer);
  clock.startPerf = performance.now() + 120;
  clock.beat0 = beat0;
  clock.nextClick = Math.ceil(beat0 - 1e-9);
  clock.timer = setInterval(tick, 25);
  startPlayheadLoop();
}
const beatNow = () => clock.beat0 + (performance.now() - clock.startPerf) / beatMs();

function tick() {
  const bm = beatMs();
  const now = performance.now();
  const look = now + 160;
  const tOf = (b) => clock.startPerf + (b - clock.beat0) * bm;

  if (clock.mode === 'count' && beatNow() >= 0) {
    clock.mode = 'rec';
    clock.t0 = tOf(0);
    renderTransport();
  }
  if (clock.mode === 'play' && tOf(clock.end) <= look) {
    if (S.loop) {
      const t = tOf(clock.end);
      clock.startPerf = t;
      clock.beat0 = clock.from;
      clock.ptr = clock.items.findIndex((it) => it.beat >= clock.from - 1e-6);
      if (clock.ptr < 0) clock.ptr = clock.items.length;
      clock.nextClick = Math.ceil(clock.from - 1e-9);
    } else if (now >= tOf(clock.end)) {
      stopAll();
      return;
    }
  }
  const clicking = clock.mode === 'count' || S.metro;
  while (tOf(clock.nextClick) <= look) {
    const b = clock.nextClick;
    const t = tOf(b);
    const idx = ((b % P.beats) + P.beats) % P.beats;
    if (clicking) synth.click(idx === 0, t);
    setTimeout(() => flashBeat(idx), Math.max(0, t - performance.now()));
    clock.nextClick++;
  }
  if (clock.mode === 'play') {
    while (clock.ptr < clock.items.length && tOf(clock.items[clock.ptr].beat) <= look) {
      const it = clock.items[clock.ptr++];
      const t = tOf(it.beat);
      const off = tOf(it.endBeat) - 30;
      it.notes.forEach((n, i) => {
        outNote(true, n, i === 0 ? 92 : 80, t);
        outNote(false, n, 0, off);
      });
    }
  }
}

function flashBeat(i) {
  const d = $$('#beat-dots i')[i];
  if (!d) return;
  d.classList.add('hit');
  d.classList.toggle('first', i === 0);
  setTimeout(() => d.classList.remove('hit'), 110);
}

function stopAll() {
  const was = clock.mode;
  clearInterval(clock.timer);
  clearTimeout(live.pendTimer);
  cancelAnimationFrame(clock.raf);
  clock.mode = 'idle';
  clock.raf = 0;
  clock.lastRow = -1;
  panicOut();
  $$('.bar.playing').forEach((b) => b.classList.remove('playing'));
  $$('.chip.now').forEach((b) => b.classList.remove('now'));
  renderTransport();
  if (was === 'rec' || was === 'armed') {
    refreshKey();
    afterEdit();
    if (P.events.length) toast('Đã ghi xong. Bấm vào ô nhịp hoặc hợp âm để sửa.');
  }
}

function startRecord() {
  stopAll();
  closeEditor();
  live.pend = null;
  snap();
  if (S.countIn) {
    clock.mode = 'count';
    startClock(-P.beats);
  } else if (S.metro) {
    clock.mode = 'rec';
    startClock(0);
    clock.t0 = clock.startPerf;
  } else {
    clock.mode = 'armed';
  }
  renderTransport();
  if (clock.mode === 'armed') toast('Sẵn sàng. Hợp âm đầu tiên bạn chơi sẽ là phách 1.');
}

function startPlay() {
  stopAll();
  closeEditor();
  const evs = sortedEvents(P);
  if (!evs.length) { toast('Chưa có hợp âm để phát. Bấm Ghi hoặc thêm hợp âm trước.'); return; }
  const endAll = Math.ceil((evs[evs.length - 1].beat + 0.001) / P.beats) * P.beats;
  let prev = null;
  clock.items = evs.map((e, i) => {
    const notes = voiceChord(transposeChord(e.chord, P.transpose), prev);
    prev = notes;
    return { beat: e.beat, endBeat: evs[i + 1] ? evs[i + 1].beat : endAll, notes };
  });
  const sel = selId && P.events.find((e) => e.id === selId);
  clock.from = sel ? Math.floor(sel.beat / P.beats + 1e-6) * P.beats : 0;
  clock.end = endAll;
  clock.ptr = clock.items.findIndex((it) => it.beat >= clock.from - 1e-6);
  if (clock.ptr < 0) clock.ptr = clock.items.length;
  clock.mode = 'play';
  startClock(clock.from);
  renderTransport();
}

function startPlayheadLoop() {
  cancelAnimationFrame(clock.raf);
  const loop = () => {
    if (clock.mode === 'idle') return;
    updatePlayhead();
    clock.raf = requestAnimationFrame(loop);
  };
  clock.raf = requestAnimationFrame(loop);
}

function updatePlayhead() {
  if (clock.mode === 'armed' || clock.mode === 'count') return;
  const beat = clock.mode === 'rec' && !clock.timer ? (performance.now() - clock.t0) / beatMs() : beatNow();
  if (beat < 0) return;
  const bar = Math.floor(beat / P.beats);
  barEls.forEach((el, i) => el && el.classList.toggle('playing', i === bar));
  if (clock.mode === 'play') {
    const cur = chordAtBeat(P, beat);
    $$('.chip', $('#sheet')).forEach((c) => c.classList.toggle('now', !!cur && c.dataset.id === cur.id));
  }
  const rowIdx = Math.floor(bar / S.perRow);
  if (rowIdx !== clock.lastRow) {
    clock.lastRow = rowIdx;
    const row = $(`.row[data-row="${rowIdx}"]`);
    if (row) {
      const r = row.getBoundingClientRect();
      if (r.top < 120 || r.bottom > window.innerHeight - 220) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
}

function renderTransport() {
  const m = clock.mode;
  const rec = $('#btn-rec');
  const play = $('#btn-play');
  rec.setAttribute('aria-pressed', String(m === 'rec' || m === 'count'));
  rec.classList.toggle('armed', m === 'armed');
  $('#rec-label').textContent = m === 'count' ? 'Đếm vào…' : m === 'rec' ? 'Dừng ghi' : m === 'armed' ? 'Chờ nốt đầu' : 'Ghi';
  play.setAttribute('aria-pressed', String(m === 'play'));
  $('#play-label').textContent = m === 'play' ? 'Dừng' : 'Phát';
  $('#play-icon').setAttribute('d', m === 'play' ? 'M3 3h4v10H3zM9 3h4v10H9z' : 'M4 2.5v11l9-5.5z');
  const busy = m !== 'idle';
  ['#bpm', '#bpm-up', '#bpm-down', '#sel-beats'].forEach((s) => { $(s).disabled = busy; });
  $('#btn-play').disabled = m === 'rec' || m === 'count' || m === 'armed';
  $('#btn-rec').disabled = m === 'play';
}

// ======================= Tông, chuyển tông, nốt hiển thị =======================
function renderKeyUI() {
  const sel = $('#sel-key');
  const k = activeKey();
  if (!sel.options.length) {
    sel.append(h('option', { value: 'auto', text: 'Tự đoán từ hợp âm' }));
    for (const mode of ['major', 'minor']) {
      for (let t = 0; t < 12; t++) {
        const kk = { tonic: t, mode };
        sel.append(h('option', { value: `${t}:${mode}`, text: `${keyName(kk)} (${keyName(kk, { solfege: false })})` }));
      }
    }
  }
  sel.value = P.keyOverride ? `${P.keyOverride.tonic}:${P.keyOverride.mode}` : 'auto';
  const note = $('#key-note');
  note.replaceChildren();
  if (!k) {
    note.append('Chưa có hợp âm nào. Ghi, hoặc bấm vào một ô nhịp để thêm.');
  } else if (k.auto) {
    const conf = { high: 'khá chắc', mid: 'tương đối', low: 'chưa chắc, cần thêm hợp âm' }[k.confidence];
    note.append('Đoán là ', h('b', { text: keyName(k) }), ` (${conf}).`);
    if (k.confidence !== 'high' && k.alt) note.append(' Cũng có thể là ', keyName(k.alt) + '. Chọn tông ở ô bên cạnh nếu bạn biết chắc.');
  } else {
    note.append('Bạn đã chọn tông ', h('b', { text: keyName(k) }), '.');
  }
  if (k && P.transpose) {
    note.append(' Sau khi chuyển tông: ', h('b', { text: keyName({ tonic: mod12(k.tonic + P.transpose), mode: k.mode }) }), '.');
  }
  $('#tr-val').textContent = (P.transpose > 0 ? '+' : '') + P.transpose;
}

function renderControls() {
  $('#title').value = P.title;
  document.title = (P.title ? P.title + ' – ' : '') + 'Hòa Âm';
  $('#bpm').value = P.bpm;
  $('#sel-beats').value = String(P.beats);
  $('#sel-quant').value = S.quant;
  $('#t-metro').setAttribute('aria-pressed', String(S.metro));
  $('#t-count').setAttribute('aria-pressed', String(S.countIn));
  $('#t-loop').setAttribute('aria-pressed', String(S.loop));
  $('#t-roman').setAttribute('aria-pressed', String(S.roman));
  const dots = $('#beat-dots');
  dots.replaceChildren(...Array.from({ length: P.beats }, () => h('i')));
}

function renderAll() {
  renderControls();
  refreshKey();
  renderKeyUI();
  renderSheet();
  renderLive();
  renderSuggest();
  renderTransport();
  updateUndoButtons();
  renderPips();
}

// ======================= Thiết bị MIDI =======================
function renderDevice() {
  const btn = $('#btn-device');
  const lbl = $('#device-label');
  btn.classList.remove('on', 'err');
  if (hub.status === 'unsupported') { lbl.textContent = 'Trình duyệt chưa hỗ trợ MIDI'; btn.classList.add('err'); }
  else if (hub.status === 'denied') { lbl.textContent = 'Chưa được cấp quyền MIDI'; btn.classList.add('err'); }
  else if (hub.status === 'ready' && hub.activeInput) { lbl.textContent = hub.activeInput.name || 'Đã nối thiết bị MIDI'; btn.classList.add('on'); }
  else lbl.textContent = hub.status === 'ready' ? 'Chưa thấy đàn' : 'Kết nối đàn';
  renderLive();
  if ($('#dlg-device').open) buildDeviceDialog();
}

function renderPips() {
  const pips = $('#pips');
  if (!pips.children.length) for (let i = 0; i < 16; i++) pips.append(h('i'));
  $$('i', pips).forEach((el, i) => el.classList.toggle('sel', S.channels.includes(i + 1)));
}

function closeBtn(dlg) {
  return h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×');
}

function buildDeviceDialog() {
  const dlg = $('#dlg-device');
  const body = $('#dlg-device-body');
  const inSel = h('select', { 'aria-label': 'Cổng vào MIDI' }, h('option', { value: 'all', text: 'Tất cả cổng vào' }),
    ...hub.inputs.map((p) => h('option', { value: p.id, text: p.name })));
  inSel.value = hub.inputId;
  inSel.addEventListener('change', () => hub.setInput(inSel.value));
  const outSel = h('select', { 'aria-label': 'Cổng ra MIDI' }, h('option', { value: 'auto', text: 'Tự chọn (ưu tiên Yamaha)' }),
    ...hub.outputs.map((p) => h('option', { value: p.id, text: p.name })));
  outSel.value = hub.outputId;
  outSel.addEventListener('change', () => hub.setOutput(outSel.value));
  const state = {
    unsupported: 'Trình duyệt này chưa hỗ trợ Web MIDI. Hãy dùng Chrome hoặc Edge trên máy tính.',
    denied: 'Trình duyệt đã chặn quyền MIDI. Bấm biểu tượng ổ khóa cạnh địa chỉ trang, cho phép MIDI, rồi tải lại trang.',
    ready: hub.inputs.length ? `Đang thấy ${hub.inputs.length} cổng vào và ${hub.outputs.length} cổng ra.` : 'Chưa thấy thiết bị nào.',
    idle: 'Chưa xin quyền MIDI.',
  }[hub.status];
  body.replaceChildren(
    closeBtn(dlg),
    h('h3', { text: 'Kết nối đàn' }),
    h('p', { class: 'sub', text: state }),
    h('label', { class: 'field' }, 'Nhận nốt từ', inSel),
    h('label', { class: 'field' }, 'Nghe thử qua đàn (khi chọn)', outSel),
    h('div', { class: 'note-box' },
      h('b', { text: 'Nếu không thấy đàn: ' }),
      'bật đàn, nối cáp vào cổng USB TO HOST, rồi bấm Quét lại. Trên Windows có thể cần cài Yamaha Steinberg USB Driver. Đóng các phần mềm khác đang giữ cổng MIDI, vì mỗi lần chỉ một chương trình dùng được.'),
    h('div', { class: 'dlg-actions' },
      h('button', { type: 'button', class: 'btn-primary', text: 'Quét lại', onclick: async () => { if (hub.status === 'ready') hub.refresh(); else await hub.init(); renderDevice(); toast(hub.activeInput ? 'Đã thấy ' + hub.activeInput.name : 'Chưa thấy thiết bị MIDI nào'); } })),
  );
}

function buildChannelsDialog() {
  const dlg = $('#dlg-channels');
  const body = $('#dlg-channels-body');
  const grid = h('div', { class: 'ch-grid' });
  const paint = () => {
    $$('button', grid).forEach((b) => b.setAttribute('aria-pressed', String(S.channels.includes(+b.dataset.ch))));
    renderPips();
    saveSettingsSoon();
    live.held.clear(); live.sustained.clear(); scheduleAnalyze(0);
  };
  for (let ch = 1; ch <= 16; ch++) {
    grid.append(h('button', { type: 'button', 'data-ch': ch, 'aria-pressed': String(S.channels.includes(ch)), text: String(ch), onclick: () => {
      S.channels = S.channels.includes(ch) ? S.channels.filter((c) => c !== ch) : [...S.channels, ch].sort((a, b) => a - b);
      if (!S.channels.length) S.channels = [ch];
      paint();
    } }));
  }
  const preset = (label, list) => h('button', { type: 'button', class: 'toggle', text: label, onclick: () => { S.channels = list; paint(); } });
  body.replaceChildren(
    closeBtn(dlg),
    h('h3', { text: 'Kênh MIDI nhận nốt' }),
    h('p', { class: 'sub', text: 'Chỉ nốt ở các kênh được chọn mới được dùng để đọc hợp âm. Chơi vài phím và nhìn vạch xanh ở dưới số kênh để biết đàn đang gửi nốt ở kênh nào.' }),
    h('div', { class: 'preset-row' }, preset('Tay đàn (1 đến 3)', [1, 2, 3]), preset('Chỉ kênh 1', [1]), preset('Tất cả kênh', Array.from({ length: 16 }, (_, i) => i + 1))),
    grid,
    h('div', { class: 'note-box' }, h('b', { text: 'Vì sao cần lọc: ' }), 'khi bật Style, đàn gửi cả bass, trống, hợp âm đệm ở các kênh cao (thường 9 đến 16). Nếu để lẫn vào, app sẽ đọc nhầm hợp âm. Phần tay phải và tay trái thường nằm ở kênh 1 đến 3.'),
  );
}

function buildSettingsDialog() {
  const dlg = $('#dlg-settings');
  const body = $('#dlg-settings-body');
  const rows = [];
  const seg = (title, desc, key, opts, after) => {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': title });
    const paint = () => $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', String(String(S[key]) === b.dataset.v)));
    for (const [v, text] of opts) {
      wrap.append(h('button', { type: 'button', 'data-v': String(v), text, onclick: () => {
        S[key] = typeof opts[0][0] === 'number' ? +v : v;
        paint(); saveSettingsSoon(); after && after();
      } }));
    }
    paint();
    rows.push(h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: title }), h('span', { text: desc })), wrap));
  };
  const sw = (title, desc, key, after) => {
    const b = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': String(!!S[key]), 'aria-label': title, onclick: () => {
      S[key] = !S[key];
      b.setAttribute('aria-checked', String(S[key]));
      saveSettingsSoon(); after && after();
    } });
    rows.push(h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: title }), h('span', { text: desc })), b));
  };
  seg('Độ chi tiết hợp âm', 'Cơ bản: tam hợp âm và hợp âm bảy. Đầy đủ: thêm 9, 11, 13 và các biến âm.', 'level', [[0, 'Cơ bản'], [1, 'Đầy đủ']], () => { analyze(); renderSuggest(); });
  seg('Dấu hóa', 'Tự động chọn thăng hoặc giáng theo tông của bài.', 'flatPref', [['auto', 'Tự động'], ['sharp', '♯'], ['flat', '♭']], () => { renderLive(); renderSheet(); renderSuggest(); });
  seg('Cách gọi tên nốt', 'Chỉ áp dụng cho dòng nốt đang bấm.', 'solfege', [[false, 'C D E'], [true, 'Đô Rê Mi']], renderLive);
  sw('Giữ hợp âm sau khi nhả phím', 'Tên hợp âm mờ đi nhưng không biến mất, tiện cho việc chép lại.', 'ghost');
  sw('Pedal sustain giữ nốt khi đọc', 'Tắt nếu bạn hay đạp pedal xuyên nhiều hợp âm.', 'pedal');
  sw('Hiện số La Mã dưới hợp âm', 'Cho biết hợp âm đứng ở bậc nào trong tông.', 'roman', () => { renderControls(); renderSheet(); });
  sw('Dùng bàn phím máy tính như phím đàn', 'Phím A, W, S, E, D, F, T, G, Y, H, U, J, K.', 'qwerty', updateDockHelp);
  seg('Nghe thử qua', 'Chọn Đàn để hợp âm gợi ý và phần phát lại vang ra loa của đàn.', 'output', [['browser', 'Trình duyệt'], ['midi', 'Đàn (MIDI)']], panicOut);
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.volume, 'aria-label': 'Âm lượng' });
  vol.addEventListener('input', () => { S.volume = +vol.value; synth.setVolume(S.volume); saveSettingsSoon(); });
  rows.push(h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: 'Âm lượng trình duyệt' }), h('span', { text: 'Không ảnh hưởng đến âm lượng của đàn.' })), vol));
  seg('Cách gọi quãng tám', 'Đàn Yamaha gọi phím giữa là C3. Chuẩn quốc tế gọi là C4.', 'octave', [['yamaha', 'Yamaha'], ['intl', 'Quốc tế']], () => { mountKeyboard(); renderLive(); updateDockHelp(); });
  seg('Số phím hiển thị', 'PSR-S975 có 61 phím.', 'keys', [[61, '61'], [76, '76'], [88, '88']], mountKeyboard);
  seg('Số ô nhịp mỗi hàng', 'Ảnh hưởng cách bản hợp âm xuống dòng và khi in.', 'perRow', [[2, '2'], [4, '4'], [6, '6'], [8, '8']], renderSheet);
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Cài đặt' }), h('p', { class: 'sub', text: 'Mọi thay đổi được lưu ngay trên trình duyệt này.' }), ...rows,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-quiet', text: 'Khôi phục mặc định', onclick: () => { Object.assign(S, DEFAULTS); synth.setVolume(S.volume); saveSettingsSoon(); mountKeyboard(); renderAll(); buildSettingsDialog(); } })));
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildLibraryDialog() {
  const dlg = $('#dlg-library');
  const body = $('#dlg-library-body');
  save();
  P.updated = Date.now();
  saveProject(P);
  const lib = Object.values(loadLibrary()).map(normalizeProject).sort((a, b) => b.updated - a.updated);
  const list = h('div', { class: 'list' });
  for (const p of lib) {
    const del = h('button', { type: 'button', class: 'btn-quiet small danger', text: 'Xóa' });
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = 'Bấm lần nữa để xóa'; setTimeout(() => { armed = false; del.textContent = 'Xóa'; }, 3000); return; }
      deleteProject(p.id);
      if (p.id === P.id) { P = newProject(); saveProject(P); resetAfterSwitch(); }
      buildLibraryDialog();
    });
    list.append(h('div', { class: 'lib-item' + (p.id === P.id ? ' cur' : '') },
      h('button', { type: 'button', class: 'lib-open', onclick: () => { P = normalizeProject(p); saveProject(P); resetAfterSwitch(); dlg.close(); } },
        h('b', { text: p.title || 'Bài chưa đặt tên' }), h('span', { text: `${p.events.length} hợp âm, ${p.bpm} BPM, sửa lúc ${fmtDate(p.updated)}` })),
      h('div', {},
        h('button', { type: 'button', class: 'btn-quiet small', text: 'Nhân đôi', onclick: () => { const c = normalizeProject({ ...JSON.parse(JSON.stringify(p)), id: uid(), title: (p.title || 'Bài chưa đặt tên') + ' (bản sao)', created: Date.now(), updated: Date.now() }); saveProject(c); saveProject(P); buildLibraryDialog(); } }), del)));
  }
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Bản nhạc của tôi' }), h('p', { class: 'sub', text: 'Lưu tự động ngay trên trình duyệt này. Muốn mang sang máy khác, hãy xuất file .json ở nút Xuất file.' }),
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-primary', text: 'Bài mới', onclick: () => { saveProject(P); P = newProject(); saveProject(P); resetAfterSwitch(); dlg.close(); } })),
    list);
}

function resetAfterSwitch() {
  stopAll();
  closeEditor();
  undoStack.length = 0;
  redoStack.length = 0;
  selId = null;
  renderAll();
}

function buildExportDialog() {
  const dlg = $('#dlg-export');
  const body = $('#dlg-export-body');
  const k = activeKey();
  const opts = { perRow: S.perRow, key: k ? { tonic: k.tonic, mode: k.mode } : null };
  const name = slug(P.title);
  const text = () => projectToText(P, opts);
  const act = (title, desc, label, fn) => h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: title }), h('span', { text: desc })), h('button', { type: 'button', class: 'btn-quiet', text: label, onclick: fn }));
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.events)) throw new Error('bad');
      P = normalizeProject({ ...d, id: uid(), updated: Date.now() });
      saveProject(P); resetAfterSwitch(); dlg.close(); toast('Đã mở ' + (P.title || 'bài chưa đặt tên'));
    } catch (e) { toast('File này không phải bản nhạc Hòa Âm.'); }
  });
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Xuất file' }), h('p', { class: 'sub', text: 'Bản xuất dùng đúng tông đã chuyển và cách viết dấu hóa đang hiển thị.' }),
    act('Sao chép dạng chữ', 'Dán vào Zalo, Notes hay tài liệu bất kỳ.', 'Sao chép', async () => { try { await navigator.clipboard.writeText(text()); toast('Đã sao chép bản hợp âm'); } catch (e) { toast('Trình duyệt không cho sao chép. Hãy tải file .txt.'); } }),
    act('Tải file chữ (.txt)', 'Hợp âm theo ô nhịp, lời nằm dưới mỗi hàng.', 'Tải .txt', () => download(name + '.txt', text(), 'text/plain;charset=utf-8')),
    act('Tải file MIDI (.mid)', 'Dãy hợp âm làm sẵn để mở trong phần mềm thu âm hoặc nạp vào đàn.', 'Tải .mid', () => download(name + '.mid', buildMidi(P), 'audio/midi')),
    act('In hoặc lưu PDF', 'Chỉ in phần bản hợp âm, nền trắng, chữ đen.', 'In', () => { dlg.close(); setTimeout(() => window.print(), 150); }),
    act('Lưu nguyên bản (.json)', 'Để chép sang máy khác hoặc sao lưu.', 'Tải .json', () => download(name + '.json', JSON.stringify(P, null, 2), 'application/json')),
    act('Mở bản đã lưu (.json)', 'Nạp lại file .json đã xuất từ Hòa Âm.', 'Chọn file', () => fileIn.click()),
    fileIn);
}

function openDlg(id, build) {
  const d = $(id);
  build();
  if (!d.open) d.showModal();
}

// ======================= Phím đàn (giao diện) =======================
let qBase = 60;
function mountKeyboard() {
  const [lo, hi] = rangeFor(S.keys);
  kbd = buildKeyboard($('#keyboard'), {
    lo, hi,
    onDown: virtualOn,
    onUp: virtualOff,
    label: (n) => noteName(0, { solfege: S.solfege }) + octOf(n),
  });
  paintKeyboard();
}
function paintKeyboard() {
  if (!kbd) return;
  const notes = heldNotes();
  const c = live.ghost ? null : currentChord();
  const rootNote = c ? notes.filter((n) => n % 12 === c.root).sort((a, b) => a - b)[0] : null;
  kbd.set(new Set(notes), rootNote ?? null, null);
}
function updateDockHelp() {
  $('#dock-help').textContent = S.qwerty ? 'Chơi thử bằng chuột hoặc phím A W S E D F T G Y H U J K. Chấm xanh là nốt gốc của hợp âm.' : 'Chấm xanh là nốt gốc của hợp âm. Bấm vào phím để nghe và thử.';
  $('#oct-val').textContent = 'C' + octOf(qBase);
}

// ======================= Bàn phím máy tính =======================
const QMAP = 'awsedftgyhujkolp;';
const qDown = new Map();
function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z' && !isTyping(e.target)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    return;
  }
  if (e.altKey || isTyping(e.target) || $('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); if (e.target.tagName === 'BUTTON') return; clock.mode === 'idle' ? startPlay() : stopAll(); return; }
  if (e.key === 'Escape') { if (!$('#editor').hidden) closeEditor(); else stopAll(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (selId) { e.preventDefault(); removeEvent(selId); } return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const evs = sortedEvents(P);
    if (!evs.length) return;
    const i = evs.findIndex((x) => x.id === selId);
    const n = e.key === 'ArrowRight' ? Math.min(evs.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    selId = evs[n].id;
    renderSheet();
    return;
  }
  if (k === 'r' && !e.repeat) { clock.mode === 'rec' || clock.mode === 'count' || clock.mode === 'armed' ? stopAll() : startRecord(); return; }
  if (!S.qwerty || e.repeat) return;
  if (k === 'z') { qBase = Math.max(24, qBase - 12); updateDockHelp(); return; }
  if (k === 'x') { qBase = Math.min(84, qBase + 12); updateDockHelp(); return; }
  const i = QMAP.indexOf(k);
  if (i >= 0 && !qDown.has(e.code)) {
    const n = qBase + i;
    qDown.set(e.code, n);
    virtualOn(n);
  }
});
document.addEventListener('keyup', (e) => {
  if (qDown.has(e.code)) { virtualOff(qDown.get(e.code)); qDown.delete(e.code); }
});
window.addEventListener('blur', () => {
  qDown.forEach((n) => virtualOff(n));
  qDown.clear();
});

// ======================= Nối dây giao diện =======================
hub.on('note', onMidiNote);
hub.on('pedal', ({ down, ch }) => {
  if (!S.channels.includes(ch)) return;
  live.pedal = down;
  if (!down && live.sustained.size) { live.sustained.clear(); scheduleAnalyze(60); }
});
hub.on('panic', () => { live.held.clear(); live.sustained.clear(); scheduleAnalyze(0); });
hub.on('devices', renderDevice);

$('#btn-device').addEventListener('click', () => openDlg('#dlg-device', buildDeviceDialog));
$('#btn-channels').addEventListener('click', () => openDlg('#dlg-channels', buildChannelsDialog));
$('#btn-settings').addEventListener('click', () => openDlg('#dlg-settings', buildSettingsDialog));
$('#btn-library').addEventListener('click', () => openDlg('#dlg-library', buildLibraryDialog));
$('#btn-export').addEventListener('click', () => openDlg('#dlg-export', buildExportDialog));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

$('#btn-rec').addEventListener('click', () => { clock.mode === 'idle' ? startRecord() : stopAll(); });
$('#btn-play').addEventListener('click', () => { clock.mode === 'idle' ? startPlay() : stopAll(); });
$('#bpm').addEventListener('change', (e) => { P.bpm = Math.min(260, Math.max(30, Math.round(+e.target.value || 90))); e.target.value = P.bpm; save(); });
$('#bpm-down').addEventListener('click', () => { P.bpm = Math.max(30, P.bpm - 1); $('#bpm').value = P.bpm; save(); });
$('#bpm-up').addEventListener('click', () => { P.bpm = Math.min(260, P.bpm + 1); $('#bpm').value = P.bpm; save(); });
let taps = [];
$('#btn-tap').addEventListener('click', () => {
  const t = performance.now();
  if (taps.length && t - taps[taps.length - 1] > 2000) taps = [];
  taps.push(t);
  taps = taps.slice(-5);
  if (taps.length >= 2) {
    const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    P.bpm = Math.min(260, Math.max(30, Math.round(60000 / avg)));
    $('#bpm').value = P.bpm;
    save();
  }
});
$('#sel-beats').addEventListener('change', (e) => { P.beats = +e.target.value; renderControls(); afterEdit(); });
$('#sel-quant').addEventListener('change', (e) => { S.quant = e.target.value; saveSettingsSoon(); });
const flip = (id, key, after) => $(id).addEventListener('click', () => { S[key] = !S[key]; $(id).setAttribute('aria-pressed', String(S[key])); saveSettingsSoon(); after && after(); });
flip('#t-metro', 'metro');
flip('#t-count', 'countIn');
flip('#t-loop', 'loop');
flip('#t-roman', 'roman', renderSheet);

$('#title').addEventListener('input', (e) => { P.title = e.target.value; document.title = (P.title ? P.title + ' – ' : '') + 'Hòa Âm'; save(); });
$('#sel-key').addEventListener('change', (e) => {
  snap();
  if (e.target.value === 'auto') P.keyOverride = null;
  else { const [t, m] = e.target.value.split(':'); P.keyOverride = { tonic: +t, mode: m }; }
  afterEdit();
});
const shiftT = (d) => { P.transpose = Math.max(-11, Math.min(11, P.transpose + d)); closeEditor(); renderKeyUI(); renderSheet(); save(); };
$('#tr-down').addEventListener('click', () => shiftT(-1));
$('#tr-up').addEventListener('click', () => shiftT(1));
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);
$('#btn-addrow').addEventListener('click', () => { snap(); P.bars = totalBars(P, S.perRow) + S.perRow; afterEdit(); });
{
  const b = $('#btn-clear');
  let armed = false;
  b.addEventListener('click', () => {
    if (!P.events.length) { toast('Chưa có hợp âm nào để xóa.'); return; }
    if (!armed) { armed = true; b.textContent = 'Bấm lần nữa để xóa'; setTimeout(() => { armed = false; b.textContent = 'Xóa hết hợp âm'; }, 3000); return; }
    armed = false; b.textContent = 'Xóa hết hợp âm';
    snap(); P.events = []; selId = null; afterEdit(); toast('Đã xóa. Bấm Hoàn tác nếu lỡ tay.');
  });
}
$('#btn-notes-mode').addEventListener('click', () => { S.solfege = !S.solfege; saveSettingsSoon(); mountKeyboard(); renderLive(); });
$('#btn-capture').addEventListener('click', () => { const c = currentChord() || (live.ghost ? live.chord : null); if (c) appendChord({ root: c.root, type: c.type, bass: c.bass }); });
$('#oct-down').addEventListener('click', () => { qBase = Math.max(24, qBase - 12); updateDockHelp(); });
$('#oct-up').addEventListener('click', () => { qBase = Math.min(84, qBase + 12); updateDockHelp(); });

window.addEventListener('beforeunload', () => { P.updated = Date.now(); saveProject(P); });

// ======================= Khởi động =======================
mountKeyboard();
updateDockHelp();
renderAll();
saveProject(P);
hub.init().then(renderDevice);

// Móc gỡ lỗi nhỏ: cho phép test bằng tay hoặc tự động mà không cần đàn thật.
window.__hoaam = {
  note: (on, note, ch = 1) => onMidiNote({ on, note, vel: 90, ch }),
  project: () => P,
  settings: S,
  clock,
  live,
  hub,
};
