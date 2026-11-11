import {
  detect, chordParts, chordText, chordKey, sameChord, transposeChord, parseChord, detectKey, keyName, keySpelling, autoFlat,
  roman, inKey, suggestNext, voiceChord, noteName, QUICK_TYPES, TYPES,
} from './engine.js';
import { barChords, newProject, sortedEvents, totalBars, uid, weightedChords } from './model.js';
import { MidiHub } from './midi.js';
import { buildKeyboard, rangeFor } from './keyboard.js';
import { buildMidi, download, projectToText, slug } from './export.js';
import { barBeats, extractChords, newSong, songEnd } from './songmidi.js';
import { createStudio } from './midiui.js';
import { DEFAULTS, deleteProject, loadCurrent, loadLibrary, loadSettings, normalizeProject, saveProject, saveSettings } from './store.js';
import { AUTHOR, NOTES, VERSION } from './version.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mod12 = (n) => ((n % 12) + 12) % 12;
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));

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

const live = { held: new Map(), sustained: new Set(), pedal: false, result: null, chord: null, ghost: false, prevCount: 0, altIdx: 0, timer: 0 };
let selId = null;
let keyCache = null;
let kbd = null;
let barEls = [];
let studio = null;
const undoStack = [];
const redoStack = [];

const saveSettingsSoon = () => saveSettings(S);
let saveTimer = 0;
let saveWarned = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    P.updated = Date.now();
    if (saveProject(P)) saveWarned = false;
    else if (!saveWarned) {
      saveWarned = true;
      toast('Bản nhạc quá lớn để lưu tự động trên trình duyệt. Hãy tải file .mid hoặc .json để giữ lại.');
    }
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

// ======================= Thông báo =======================
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  // Khi một phần đang toàn màn hình, chỉ phần đó được hiển thị, nên thông báo phải nằm trong nó.
  const fe = document.fullscreenElement;
  const host = (fe && fe !== document.documentElement ? fe : null) || ($('.css-full') ?? document.body);
  if (t.parentElement !== host) host.append(t);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ======================= Nghe thử qua đàn =======================
let warnedNoOut = false;
function audition(chord, ms = 1100) {
  if (!hub.activeOutput) {
    if (!warnedNoOut) { warnedNoOut = true; toast('Nối đàn để nghe thử. Hòa Âm không phát tiếng bằng loa máy tính.'); }
    return;
  }
  const notes = voiceChord(chord);
  const t = performance.now() + 20;
  notes.forEach((n) => {
    hub.noteOn(n, 84, 1, t);
    hub.noteOff(n, 1, t + ms);
  });
}

// ======================= Nhận nốt =======================
const pipHit = new Map();
function flashPip(ch) {
  const b = $(`#dlg-device-body [data-ch="${ch}"]`);
  if (b) {
    b.classList.add('hit');
    clearTimeout(pipHit.get(ch));
    pipHit.set(ch, setTimeout(() => b.classList.remove('hit'), 220));
  }
}

function onMidiNote({ on, note, vel, ch }) {
  flashPip(ch);
  if (!S.channels.includes(ch)) return;
  if (on) {
    live.held.set(note, { vel, ch });
    live.sustained.delete(note);
    scheduleAnalyze(35);
  } else {
    if (live.pedal && S.pedal) live.sustained.add(note);
    else live.held.delete(note);
    scheduleAnalyze(90);
  }
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
    renderLive();
    return;
  }
  live.ghost = false;
  live.result = res;
  live.altIdx = 0;
  live.chord = res.candidates[0] || null;
  renderLive();
  renderSuggest();
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
  if (hub.status === 'ready' && !hub.activeInput) return 'Chưa thấy đàn. Cắm USB, bật đàn rồi bấm Kết nối đàn ở góc trên.';
  return null;
}

function renderLive() {
  const box = $('#chord-live');
  const r = live.result;
  const c = currentChord();
  const flat = c ? flatFor(c, 0) : false;
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
      else q.append('Chơi một hợp âm trên đàn, tên nó hiện ', h('em', { text: 'ở đây' }), '.');
    }
    wrap.append(q);
    return wrap;
  };
  const sig = c ? chordKey(c) : r ? r.kind + (r.kind === 'single' ? r.notes[0] : '') : 'idle' + (deviceHint() || '');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(build());
  }
  box.classList.toggle('ghost', live.ghost);
  paintKeyboard();

  const ro = $('#notes-readout');
  if (r && r.notes.length && !live.ghost) ro.textContent = r.notes.map((n) => noteLabel(n, flat)).join('  ');
  else if (live.ghost && r) ro.textContent = 'Hợp âm vừa chơi, đang giữ lại';
  else ro.textContent = '';
  $('#btn-notes-mode').textContent = S.solfege ? 'Gọi nốt: Đô Rê Mi' : 'Gọi nốt: C D E';
  $('#btn-capture').disabled = !c;

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
            onclick: () => { live.altIdx = i; live.ghost = false; renderLive(); renderSuggest(); },
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
    box.append(h('p', { class: 'empty-line', text: 'Chưa biết tông. Thêm vài hợp âm vào bản nhạc hoặc chọn tông thủ công.' }));
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
    hint.textContent = 'Thêm vài hợp âm, Hòa Âm sẽ đoán tông rồi gợi ý bước kế tiếp.';
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
  hint.textContent = `${lastTxt ? 'Sau ' + lastTxt + ', t' : 'T'}rong tông ${keyName(k)}. Bấm để nghe qua đàn, bấm dấu cộng để thêm vào bản nhạc.`;
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
const chartState = () => JSON.stringify({ events: P.events, rows: P.rows, bars: P.bars, bpm: P.bpm, beats: P.beats });
function snap() {
  undoStack.push(chartState());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function restore(json) {
  const d = JSON.parse(json);
  P.events = d.events;
  P.rows = d.rows;
  P.bars = d.bars;
  if (d.bpm) P.bpm = d.bpm;
  if (d.beats) P.beats = d.beats;
  renderControls();
  afterEdit();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(chartState());
  restore(undoStack.pop());
  updateUndoButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(chartState());
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
      class: 'row-label', type: 'text', placeholder: 'Tên đoạn (Intro, Verse...)', 'aria-label': `Tên đoạn của hàng ${r + 1}`, maxlength: 40,
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
      }, h('span', { class: 'bar-no', 'aria-hidden': 'true', text: String(i + 1) }));
      if (carry) el.append(h('div', { class: 'bar-carry', style: `grid-column: 1 / span ${Math.max(1, Math.round(carry.span * 4))}`, title: 'Giữ hợp âm ở ô trước' }));
      for (const c of chords) {
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
    const lyrics = h('textarea', { class: 'lyrics', rows: 1, placeholder: 'Lời bài hát cho các ô nhịp này', 'aria-label': `Lời của hàng ${r + 1}` });
    lyrics.value = meta.lyrics || '';
    const fit = () => { lyrics.style.height = 'auto'; if (lyrics.scrollHeight > 0) lyrics.style.height = lyrics.scrollHeight + 'px'; };
    lyrics.addEventListener('focus', () => snapOnce());
    lyrics.addEventListener('input', () => { (P.rows[r] ||= {}).lyrics = lyrics.value; fit(); save(); });
    frag.append(
      h('div', { class: 'row', 'data-row': r },
        h('div', { class: 'row-head' }, label, h('span', { class: 'row-range', text: `Ô ${r * per + 1} đến ${r * per + per}` })),
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
        h('button', { type: 'button', class: 'btn-ghost small', text: 'Nghe thử', onclick: () => audition(transposeChord(ed.chord, -T)) }),
        ev ? h('button', { type: 'button', class: 'btn-ghost small danger', text: 'Xóa', onclick: () => { removeEvent(ev.id); closeEditor(); } }) : null),
      h('div', { class: 'group' },
        h('button', { type: 'button', class: 'btn-ghost small', text: 'Hủy', onclick: closeEditor }),
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

// ======================= Tông, chuyển tông =======================
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
    note.append('Chưa có hợp âm nào. Bấm vào một ô nhịp để thêm, hoặc mở file MIDI ở tab Nhạc MIDI.');
  } else if (k.auto) {
    const conf = { high: 'khá chắc', mid: 'tương đối', low: 'chưa chắc, cần thêm hợp âm' }[k.confidence];
    note.append('Đoán là ', h('b', { text: keyName(k) }), ` (${conf}).`);
    if (k.confidence !== 'high' && k.alt) note.append(' Cũng có thể là ', keyName(k.alt) + '. Chọn tông ở ô bên dưới nếu bạn biết chắc.');
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
  const bpm = $('#bpm');
  bpm.value = P.bpm;
  bpm.disabled = !!P.midi;
  bpm.title = P.midi ? 'Tempo đang lấy theo bài MIDI. Đổi ở tab Nhạc MIDI.' : '';
  $('#sel-beats').value = String(P.beats);
  $('#t-roman').setAttribute('aria-pressed', String(S.roman));
}

function renderAll() {
  renderControls();
  refreshKey();
  renderKeyUI();
  renderSheet();
  renderLive();
  renderSuggest();
  updateUndoButtons();
  renderMidiTab();
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
  studio && studio.refreshDevice();
  if ($('#dlg-device').open) buildDeviceDialog();
}

function closeBtn(dlg) {
  return h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×');
}

function buildDeviceDialog() {
  const dlg = $('#dlg-device');
  const body = $('#dlg-device-body');
  const inSel = h('select', { 'aria-label': 'Cổng vào MIDI' }, h('option', { value: 'all', text: 'Tự chọn (ưu tiên Yamaha)' }),
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

  const grid = h('div', { class: 'ch-grid' });
  const paint = () => {
    $$('button', grid).forEach((b) => b.setAttribute('aria-pressed', String(S.channels.includes(+b.dataset.ch))));
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
    h('h3', { text: 'Kết nối đàn' }),
    h('p', { class: 'sub', text: state }),
    h('label', { class: 'field wide' }, h('span', { text: 'Nhận nốt từ' }), inSel),
    h('label', { class: 'field wide' }, h('span', { text: 'Phát nhạc ra' }), outSel),
    h('div', { class: 'set-block' },
      h('b', { text: 'Kênh dùng để đọc hợp âm' }),
      h('span', { class: 'hint', text: 'Chơi vài phím, vạch xanh dưới số kênh cho biết đàn đang gửi nốt ở kênh nào. Tay phải và tay trái thường ở kênh 1 đến 3, phần đệm Style ở kênh cao hơn.' }),
      h('div', { class: 'preset-row' }, preset('Tay đàn (1 đến 3)', [1, 2, 3]), preset('Chỉ kênh 1', [1]), preset('Tất cả kênh', Array.from({ length: 16 }, (_, i) => i + 1))),
      grid),
    h('div', { class: 'note-box' },
      h('b', { text: 'Nếu không thấy đàn: ' }),
      'bật đàn, nối cáp vào cổng USB TO HOST, rồi bấm Quét lại. Trên Windows có thể cần cài Yamaha Steinberg USB Driver. Đóng các phần mềm khác đang giữ cổng MIDI, vì mỗi lần chỉ một chương trình dùng được.'),
    h('div', { class: 'dlg-actions' },
      h('button', { type: 'button', class: 'btn-primary', text: 'Quét lại', onclick: async () => { if (hub.status === 'ready') hub.refresh(); else await hub.init(); renderDevice(); toast(hub.activeInput ? 'Đã thấy ' + hub.activeInput.name : 'Chưa thấy thiết bị MIDI nào'); } })),
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
  seg('Cách gọi tên nốt', 'Chỉ áp dụng cho dòng nốt đang chơi.', 'solfege', [[false, 'C D E'], [true, 'Đô Rê Mi']], renderLive);
  sw('Giữ hợp âm sau khi nhả phím', 'Tên hợp âm mờ đi nhưng không biến mất, tiện cho việc chép lại.', 'ghost');
  sw('Pedal sustain giữ nốt khi đọc', 'Tắt nếu bạn hay đạp pedal xuyên nhiều hợp âm.', 'pedal');
  sw('Hiện số La Mã dưới hợp âm', 'Cho biết hợp âm đứng ở bậc nào trong tông.', 'roman', () => { renderControls(); renderSheet(); });
  seg('Cách gọi quãng tám', 'Đàn Yamaha gọi phím giữa là C3. Chuẩn quốc tế gọi là C4.', 'octave', [['yamaha', 'Yamaha'], ['intl', 'Quốc tế']], () => { mountKeyboard(); renderLive(); studio && studio.resize(); });
  seg('Số phím hiển thị', 'PSR-S975 có 61 phím.', 'keys', [[61, '61'], [76, '76'], [88, '88']], mountKeyboard);
  seg('Số ô nhịp mỗi hàng', 'Ảnh hưởng cách bản hợp âm xuống dòng và khi in.', 'perRow', [[2, '2'], [4, '4'], [6, '6'], [8, '8']], renderSheet);
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Cài đặt' }), h('p', { class: 'sub', text: 'Mọi thay đổi được lưu ngay trên trình duyệt này.' }), ...rows,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Khôi phục mặc định', onclick: () => { Object.assign(S, DEFAULTS); saveSettingsSoon(); mountKeyboard(); renderAll(); buildSettingsDialog(); } })));
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
    const del = h('button', { type: 'button', class: 'btn-ghost small danger', text: 'Xóa' });
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = 'Bấm lần nữa để xóa'; setTimeout(() => { armed = false; del.textContent = 'Xóa'; }, 3000); return; }
      deleteProject(p.id);
      if (p.id === P.id) { P = newProject(); saveProject(P); resetAfterSwitch(); }
      buildLibraryDialog();
    });
    list.append(h('div', { class: 'lib-item' + (p.id === P.id ? ' cur' : '') },
      h('button', { type: 'button', class: 'lib-open', onclick: () => { P = normalizeProject(p); saveProject(P); resetAfterSwitch(); dlg.close(); } },
        h('b', { text: p.title || 'Bài chưa đặt tên' }), h('span', { text: `${p.events.length} hợp âm${p.midi ? ' + MIDI' : ''}, ${p.bpm} BPM, sửa lúc ${fmtDate(p.updated)}` })),
      h('div', { class: 'lib-actions' },
        h('button', { type: 'button', class: 'btn-ghost small', text: 'Nhân đôi', onclick: () => { const c = normalizeProject({ ...JSON.parse(JSON.stringify(p)), id: uid(), title: (p.title || 'Bài chưa đặt tên') + ' (bản sao)', created: Date.now(), updated: Date.now() }); saveProject(c); saveProject(P); buildLibraryDialog(); } }), del)));
  }
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Bản nhạc của tôi' }), h('p', { class: 'sub', text: 'Lưu tự động ngay trên trình duyệt này. Muốn mang sang máy khác, hãy xuất file .json ở nút Xuất file.' }),
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-primary', text: 'Bài mới', onclick: () => { saveProject(P); P = newProject(); saveProject(P); resetAfterSwitch(); dlg.close(); } })),
    list);
}

function resetAfterSwitch() {
  studio && studio.stop();
  studio && studio.show(P.midi, '');
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
  const act = (title, desc, label, fn) => h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: title }), h('span', { text: desc })), h('button', { type: 'button', class: 'btn-ghost', text: label, onclick: fn }));
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
    act('Tải dãy hợp âm (.mid)', 'Chỉ phần hợp âm, để mở trong phần mềm thu âm hoặc nạp vào đàn. Bài MIDI đầy đủ tải ở tab Nhạc MIDI.', 'Tải .mid', () => download(name + '.mid', buildMidi(P), 'audio/midi')),
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

// ======================= Phím đàn (chỉ để nhìn) =======================
function mountKeyboard() {
  const [lo, hi] = rangeFor(S.keys);
  kbd = buildKeyboard($('#keyboard'), { lo, hi, label: (n) => noteName(0, { solfege: S.solfege }) + octOf(n) });
  paintKeyboard();
}
function paintKeyboard() {
  if (!kbd) return;
  const notes = heldNotes();
  const c = live.ghost ? null : currentChord();
  const rootNote = c ? notes.filter((n) => n % 12 === c.root).sort((a, b) => a - b)[0] : null;
  kbd.set(new Set(notes), rootNote ?? null, null);
}

// ======================= Hai khu làm việc =======================
let view = 'home';
// Vào Hợp âm hoặc Nhạc MIDI thì cả app toàn màn hình, như một ứng dụng. Phải đến từ một cú bấm của người dùng.
function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return Promise.resolve();
  return el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
let wantFull = true; // false sau khi người dùng tự thoát toàn màn hình, để không ép vào lại
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && view !== 'home') wantFull = false; });
// Mở thẳng link Hợp âm/MIDI chưa được fullscreen: cú bấm hoặc phím đầu tiên (bất kỳ) sẽ vào toàn màn hình.
const firstGesture = (e) => { if (view !== 'home' && wantFull && e.key !== 'Escape') enterFullscreen(); };
document.addEventListener('pointerdown', firstGesture, true);
document.addEventListener('keydown', firstGesture, true);
function showView(name) {
  view = name;
  if (name !== 'home') { wantFull = true; enterFullscreen(); }
  $('#view-home').hidden = name !== 'home';
  $('#tab-home').setAttribute('aria-selected', String(name === 'home'));
  if (name === 'home') renderHome();
  $('#view-chords').hidden = name !== 'chords';
  $('#view-midi').hidden = name !== 'midi';
  $('#tab-chords').setAttribute('aria-selected', String(name === 'chords'));
  $('#tab-midi').setAttribute('aria-selected', String(name === 'midi'));
  if (name !== 'midi') { studio && studio.stop(); $$('.lyrics').forEach((t) => { t.style.height = 'auto'; if (t.scrollHeight > 0) t.style.height = t.scrollHeight + 'px'; }); }
  else studio && requestAnimationFrame(() => studio.resize());
  window.scrollTo({ top: 0 });
}
const routeFromHash = () => (location.hash === '#midi' ? 'midi' : location.hash === '#hop-am' ? 'chords' : 'home');
$('#tab-home').addEventListener('click', () => { location.hash = '#trang-chu'; });
$('#tab-chords').addEventListener('click', () => { location.hash = '#hop-am'; });
$('#tab-midi').addEventListener('click', () => { location.hash = '#midi'; });
window.addEventListener('hashchange', () => showView(routeFromHash()));

function renderHome() {
  const r = $('#home-resume');
  const title = (P.title || '').trim();
  if (P.midi || P.events.length) {
    r.hidden = false;
    r.textContent = 'Tiếp tục: ' + (title || (P.midi ? 'bài MIDI đang mở' : 'bài chưa đặt tên'));
    r.onclick = () => { location.hash = P.midi && !P.events.length ? '#midi' : '#hop-am'; };
  } else r.hidden = true;
}
{
  $('#ver-chip').textContent = 'Phiên bản ' + VERSION;
  $('#home-ver').textContent = 'Có gì mới ở ' + VERSION;
  $('#home-notes').replaceChildren(...NOTES.map((t) => h('li', { text: t })));
  $('#foot-ver').textContent = 'v' + VERSION;
  $('#foot-author').textContent = AUTHOR;
  $$('[data-go]').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.go; }));
  $('#home-open-midi').addEventListener('click', () => { location.hash = '#midi'; studio.pickFile(); });
  $('#home-learn').addEventListener('click', () => {
    location.hash = '#midi';
    if (studio.hasSong()) studio.openLearn(); else studio.pickFile();
  });
}

function renderMidiTab() {
  const t = $('#tab-midi');
  t.classList.toggle('has', !!P.midi);
}

// ======================= Phím tắt =======================
function isTyping(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      if (view === 'midi') e.shiftKey ? studio.redo() : studio.undo();
      else e.shiftKey ? redo() : undo();
    }
    return;
  }
  if (e.altKey || isTyping(e.target) || $('dialog[open]')) return;
  if (e.key === ' ') {
    if (view !== 'midi') return;
    if (e.target.tagName === 'BUTTON') return; // để nút tự nhận phím Space
    e.preventDefault();
    studio.togglePlay();
    return;
  }
  if (view === 'midi') return;
  if (e.key === 'Escape') { closeEditor(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (selId) { e.preventDefault(); removeEvent(selId); } return; }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const evs = sortedEvents(P);
    if (!evs.length) return;
    const i = evs.findIndex((x) => x.id === selId);
    const n = e.key === 'ArrowRight' ? Math.min(evs.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    selId = evs[n].id;
    renderSheet();
  }
});

// ======================= Nối dây giao diện =======================
hub.on('note', onMidiNote);
hub.on('pedal', ({ down, ch }) => {
  if (!S.channels.includes(ch)) return;
  live.pedal = down;
  if (!down && live.sustained.size) { live.sustained.clear(); scheduleAnalyze(0); }
});
hub.on('panic', () => { live.held.clear(); live.sustained.clear(); scheduleAnalyze(0); });
hub.on('devices', renderDevice);

$('#btn-device').addEventListener('click', () => openDlg('#dlg-device', buildDeviceDialog));
$('#btn-settings').addEventListener('click', () => openDlg('#dlg-settings', buildSettingsDialog));
$('#btn-library').addEventListener('click', () => openDlg('#dlg-library', buildLibraryDialog));
$('#btn-export').addEventListener('click', () => openDlg('#dlg-export', buildExportDialog));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

const flip = (id, key, after) => $(id).addEventListener('click', () => { S[key] = !S[key]; $(id).setAttribute('aria-pressed', String(S[key])); saveSettingsSoon(); after && after(); });
flip('#t-roman', 'roman', renderSheet);

$('#bpm').addEventListener('change', (e) => { P.bpm = clampN(Math.round(+e.target.value || 90), 30, 260); e.target.value = P.bpm; save(); });
$('#sel-beats').addEventListener('change', (e) => { snap(); P.beats = +e.target.value; renderControls(); afterEdit(); });
$('#title').addEventListener('input', (e) => { P.title = e.target.value; document.title = (P.title ? P.title + ' – ' : '') + 'Hòa Âm'; save(); });
$('#sel-key').addEventListener('change', (e) => {
  snap();
  if (e.target.value === 'auto') P.keyOverride = null;
  else { const [t, m] = e.target.value.split(':'); P.keyOverride = { tonic: +t, mode: m }; }
  afterEdit();
});
const shiftT = (d) => { P.transpose = clampN(P.transpose + d, -11, 11); closeEditor(); renderKeyUI(); renderSheet(); save(); };
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

window.addEventListener('beforeunload', () => { P.updated = Date.now(); saveProject(P); });

// ======================= Nhạc MIDI =======================
function adoptMidi(song, name) {
  const wasLearning = !!(studio && studio.learn && studio.learn.isOpen());
  const fresh = !P.events.length && !P.midi && !P.title;
  if (!fresh) { saveProject(P); P = newProject(); }
  const blank = name === 'Bài mới';
  P.midi = song;
  P.title = song.title && song.title !== 'Hoa Am' ? song.title : blank ? '' : name;
  P.bpm = clampN(Math.round(song.tempos[0].bpm), 30, 260);
  P.beats = clampN(Math.round(barBeats(song)), 2, 6);
  P.bars = clampN(Math.ceil(songEnd(song) / song.ppq / P.beats), 8, 400);
  P.transpose = 0;
  P.keyOverride = null;
  P.events = [];
  resetAfterSwitch();
  studio.show(song, name);
  if (wasLearning && !blank) studio.openLearn(); // đang học mà đổi file thì học luôn bài mới
  const ids = song.parts.filter((p) => p.channel !== 9 && p.notes.length).map((p) => p.id);
  let msg = blank ? 'Đã tạo bài trống. Bấm đúp vào piano roll để thêm nốt đầu tiên.' : 'Đã mở file MIDI. Nối đàn rồi bấm Phát để nghe.';
  if (ids.length) {
    const ev = extractChords(song, { partIds: ids, unitBeats: P.beats });
    P.events = ev.map((e) => ({ id: uid(), beat: e.beat, chord: e.chord }));
    if (ev.length) msg += ` Đã đoán ${ev.length} hợp âm sang tab Hợp âm.`;
  }
  P.updated = Date.now();
  saveProject(P);
  renderAll();
  if (view !== 'midi') location.hash = '#midi';
  toast(msg);
}

function applyChords(ev, { beats }) {
  snap();
  P.beats = clampN(Math.round(beats), 2, 6);
  P.events = ev.map((e) => ({ id: uid(), beat: e.beat, chord: e.chord }));
  P.bars = Math.max(8, Math.ceil((ev[ev.length - 1].beat + 0.001) / P.beats));
  selId = null;
  renderControls();
  afterEdit();
  const fs = document.fullscreenElement;
  if (fs && fs !== document.documentElement) document.exitFullscreen().then(enterFullscreen).catch(() => {});
  location.hash = '#hop-am';
  toast(`Đã lấy ${ev.length} hợp âm vào bản nhạc.`);
}

studio = createStudio({
  root: $('#studio-root'), h, hub, toast,
  getP: () => P,
  onSongChange: (song) => { P.midi = song; if (song) P.bpm = clampN(Math.round(song.tempos[0].bpm), 30, 260); renderControls(); renderMidiTab(); save(); },
  stopOther: () => {},
  openDevice: () => openDlg('#dlg-device', buildDeviceDialog),
  adopt: adoptMidi,
  applyChords,
  noteLabel: (n) => noteLabel(n, false),
  acceptCh: (ch) => S.channels.includes(ch),
  download, slug,
});

// Kéo thả file .mid vào bất kỳ đâu
{
  const drop = $('#drop');
  let depth = 0;
  const hasFile = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFile(e)) { depth++; drop.hidden = false; } });
  document.addEventListener('dragleave', (e) => { if (hasFile(e) && --depth <= 0) { depth = 0; drop.hidden = true; } });
  document.addEventListener('dragover', (e) => { if (hasFile(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFile(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = [...e.dataTransfer.files].find((x) => /\.(mid|midi|kar)$/i.test(x.name));
    f ? studio.openFile(f) : toast('Chỉ mở được file .mid hoặc .midi.');
  });
}

// ======================= Khởi động =======================
mountKeyboard();
renderAll();
studio.show(P.midi, '');
showView(routeFromHash());
saveProject(P);
hub.init().then(renderDevice);

// Móc gỡ lỗi nhỏ: cho phép test tự động mà không cần đàn thật.
window.__hoaam = {
  note: (on, note, ch = 1) => onMidiNote({ on, note, vel: 90, ch }),
  project: () => P,
  settings: S,
  live,
  hub,
  studio,
  adoptMidi,
};


// ======================= Chạy như app =======================
// Không bôi đen, không menu chuột phải (trừ trong ô nhập chữ), không kéo thả.
const isEditable = (t) => t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]');
document.addEventListener('contextmenu', (e) => { if (!isEditable(e.target)) e.preventDefault(); });
document.addEventListener('selectstart', (e) => { if (!isEditable(e.target)) e.preventDefault(); });
document.addEventListener('dragstart', (e) => { if (!isEditable(e.target)) e.preventDefault(); });

// Cài ra màn hình: mở từ biểu tượng là toàn màn hình luôn (manifest display: fullscreen).
let installEvt = null;
const installBtn = $('#btn-install');
const isInstalled = () => matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e;
  if (!isInstalled()) installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; toast('Đã cài Hòa Âm ra màn hình.'); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
