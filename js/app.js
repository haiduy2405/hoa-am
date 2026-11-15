import { MidiHub } from './midi.js';
import { download, slug } from './export.js';
import { createStudio } from './midiui.js';
import { DEFAULTS, currentId, deleteSong, listSongs, loadSettings, loadSong, newId, saveSettings, saveSong, setCurrent } from './store.js';
import { createPianoDock } from './pianodock.js';
import { starsOf, totalStars, streak, difficulty, DIFF_TEXT } from './progress.js';
import { cleanTitle } from './title.js';
import { parseMidi } from './songmidi.js';
import { AUTHOR, NOTES, VERSION } from './version.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

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
const hub = new MidiHub();
let studio = null;
let curId = null; // id bài đang mở trong kho

const saveSettingsSoon = () => saveSettings(S);
let saveTimer = 0;
let saveWarned = false;
function saveNow(song) {
  if (!song || !curId) return;
  if (saveSong(curId, song)) saveWarned = false;
  else if (!saveWarned) {
    saveWarned = true;
    toast('Bài quá lớn để lưu tự động trên trình duyệt. Hãy tải file .mid để giữ lại.');
  }
}
function save(song) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(song), 250);
}

// ======================= Tên nốt =======================
const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const SOL = ['Đô', 'Đô♯', 'Rê', 'Rê♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
// Yamaha gọi phím giữa (MIDI 60) là C3, chuẩn quốc tế gọi là C4.
const octOf = (n) => Math.floor(n / 12) - (S.octave === 'intl' ? 1 : 2);
const noteLabel = (n) => (S.solfege ? SOL : SHARP)[n % 12] + octOf(n);

// ======================= Thông báo =======================
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  // Khi một phần đang toàn màn hình riêng, chỉ phần đó được hiển thị, nên thông báo phải nằm trong nó.
  const fe = document.fullscreenElement;
  const host = fe && fe !== document.documentElement ? fe : document.body;
  if (t.parentElement !== host) host.append(t);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

// ======================= Hộp thoại =======================
function closeBtn(dlg) {
  return h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Đóng', onclick: () => dlg.close() }, '×');
}
function openDlg(id, build) {
  const d = $(id);
  build();
  if (!d.open) d.showModal();
}

function renderDevice() {
  const btn = $('#btn-device');
  const lbl = $('#device-label');
  btn.classList.remove('on', 'err');
  if (hub.status === 'unsupported') { lbl.textContent = 'Trình duyệt chưa hỗ trợ MIDI'; btn.classList.add('err'); }
  else if (hub.status === 'denied') { lbl.textContent = 'Chưa được cấp quyền MIDI'; btn.classList.add('err'); }
  else if (hub.status === 'ready' && hub.activeInput) { lbl.textContent = hub.activeInput.name || 'Đã nối thiết bị MIDI'; btn.classList.add('on'); }
  else lbl.textContent = hub.status === 'ready' ? 'Chưa thấy đàn' : 'Kết nối đàn';
  studio && studio.refreshDevice();
  if ($('#dlg-device').open) buildDeviceDialog();
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
      h('b', { text: 'Kênh nhận nốt khi học bài' }),
      h('span', { class: 'hint', text: 'Tay phải và tay trái thường ở kênh 1 đến 3. Phần đệm Style của đàn ở kênh cao hơn, nên loại ra để không bị tính nhầm.' }),
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
  const seg = (title, desc, key, opts) => {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': title });
    const paint = () => $$('button', wrap).forEach((b) => b.setAttribute('aria-pressed', String(String(S[key]) === b.dataset.v)));
    for (const [v, text] of opts) {
      wrap.append(h('button', { type: 'button', 'data-v': String(v), text, onclick: () => {
        S[key] = typeof opts[0][0] === 'boolean' ? v : v;
        paint(); saveSettingsSoon();
      } }));
    }
    paint();
    rows.push(h('div', { class: 'set' }, h('div', { class: 'set-text' }, h('b', { text: title }), h('span', { text: desc })), wrap));
  };
  seg('Cách gọi tên nốt', 'Hiện trên phím đàn khi học bài.', 'solfege', [[false, 'C D E'], [true, 'Đô Rê Mi']]);
  seg('Cách gọi quãng tám', 'Đàn Yamaha gọi phím giữa là C3. Chuẩn quốc tế gọi là C4.', 'octave', [['yamaha', 'Yamaha'], ['intl', 'Quốc tế']]);
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Cài đặt' }), h('p', { class: 'sub', text: 'Mọi thay đổi được lưu ngay trên trình duyệt này.' }), ...rows,
    notesBlock(),
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Khôi phục mặc định', onclick: () => { Object.assign(S, DEFAULTS); saveSettingsSoon(); buildSettingsDialog(); } })));
}

// Ghi chú phiên bản: mặc định chỉ hiện 3 dòng mới nhất, bấm Xem thêm mới hiện hết.
function notesBlock() {
  const SHOW = 3;
  let all = false;
  const ul = h('ul', { class: 'notes' });
  const more = h('button', { type: 'button', class: 'notes-more' });
  const paint = () => {
    ul.replaceChildren(...(all ? NOTES : NOTES.slice(0, SHOW)).map((n) => h('li', { text: n })));
    more.textContent = all ? 'Thu gọn' : `Xem thêm (${NOTES.length - SHOW})`;
    more.hidden = NOTES.length <= SHOW;
  };
  more.addEventListener('click', () => { all = !all; paint(); });
  paint();
  return h('div', { class: 'set-block' }, h('b', { text: `Nốt Rơi ${VERSION}, làm bởi ${AUTHOR}` }), ul, more);
}

const fmtDate = (ts) => new Date(ts).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function buildLibraryDialog() {
  const dlg = $('#dlg-library');
  const body = $('#dlg-library-body');
  const songs = listSongs();
  const list = h('div', { class: 'list' });
  if (!songs.length) list.append(h('p', { class: 'hint', text: 'Chưa có bài nào. Bài bạn mở sẽ được lưu ở đây.' }));
  for (const p of songs) {
    const del = h('button', { type: 'button', class: 'btn-ghost small danger', text: 'Xóa' });
    let armed = false;
    del.addEventListener('click', () => {
      if (!armed) { armed = true; del.textContent = 'Bấm lần nữa để xóa'; setTimeout(() => { armed = false; del.textContent = 'Xóa'; }, 3000); return; }
      deleteSong(p.id);
      if (p.id === curId) { curId = null; studio.show(null); }
      studio.refreshRecent();
      buildLibraryDialog();
    });
    list.append(h('div', { class: 'lib-item' + (p.id === curId ? ' cur' : '') },
      h('button', { type: 'button', class: 'lib-open', onclick: () => { openSaved(p.id); dlg.close(); } },
        h('b', { text: p.title || 'Bài chưa đặt tên' }), h('span', { text: `${p.parts} phần, ${p.notes.toLocaleString('vi-VN')} nốt, ${p.bpm} BPM, sửa lúc ${fmtDate(p.updated)}` })),
      h('div', { class: 'lib-actions' }, del)));
  }
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Bản nhạc của tôi' }), h('p', { class: 'sub', text: 'Lưu tự động ngay trên trình duyệt này. Muốn mang sang máy khác, hãy tải file .mid.' }), list);
}

// ======================= Bài MIDI =======================
function adoptMidi(song, name, { id = null, exact = false } = {}) {
  saveNow(studio.getSong());
  song.title = exact ? name : cleanTitle(name); // tên bài lấy từ tên file, không dùng tên track trong file (thường chỉ là "Piano")
  curId = id || newId();
  studio.show(song, name);
  saveNow(song);
  toast('Đã mở file MIDI. Nối đàn rồi bấm Phát để nghe.');
}
function openSaved(id) {
  const song = loadSong(id);
  if (!song) { toast('Không mở được bài này.'); return; }
  saveNow(studio.getSong());
  curId = id;
  setCurrent(id);
  studio.show(song, song.title);
}

// ======================= Kho bài có sẵn =======================
let catalog = null;
const plain = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
async function loadCatalog() {
  if (catalog) return catalog;
  const r = await fetch('songs/index.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('Không tải được kho bài.');
  catalog = (await r.json()).songs.map((s) => ({ ...s, key: plain(`${s.title} ${s.artist} ${s.cat}`) }));
  catalog.sort((x, y) => x.title.localeCompare(y.title, 'vi'));
  return catalog;
}
const fmtDur = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
async function openCatalogSong(entry) {
  try {
    const r = await fetch('songs/' + encodeURIComponent(entry.file), { cache: 'no-cache' });
    if (!r.ok) throw new Error('Không tải được bài này.');
    const song = parseMidi(new Uint8Array(await r.arrayBuffer()));
    $('#dlg-kho').close();
    adoptMidi(song, entry.title, { id: 'kho:' + entry.file, exact: true });
  } catch (e) {
    toast(e && e.message ? e.message : 'Không mở được bài này.');
  }
}
async function buildKhoDialog() {
  const dlg = $('#dlg-kho');
  const body = $('#dlg-kho-body');
  let list;
  try { list = await loadCatalog(); } catch (e) { toast(e.message); return; }
  const cats = ['Tất cả', ...new Set(list.map((s) => s.cat))];
  let cat = 'Tất cả', diff = 'all';
  const search = h('input', { type: 'search', class: 'kho-search', placeholder: `Tìm trong ${list.length} bài`, 'aria-label': 'Tìm bài', autocomplete: 'off' });
  const chips = h('div', { class: 'kho-chips' });
  const rows = h('div', { class: 'kho-grid', role: 'list' });
  const count = h('span', { class: 'hint' });
  const hue = (t) => { let x = 0; for (const c of t) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
  const shown = () => { const q = plain(search.value).trim().split(/\s+/).filter(Boolean); return list.filter((s) => (cat === 'Tất cả' || s.cat === cat) && (diff === 'all' || difficulty(s) === diff) && q.every((w) => s.key.includes(w))); };
  const paint = () => {
    const items = shown();
    count.textContent = `${items.length} bài`;
    rows.replaceChildren(...(items.length ? items.map((s) => {
      const st = starsOf(s.title), d = difficulty(s);
      return h('button', { type: 'button', class: 'kho-card', role: 'listitem', style: `--hue:${hue(s.title)}`, onclick: () => openCatalogSong(s) },
        h('span', { class: 'kc-top' }, h('span', { class: 'kc-diff d-' + d, text: DIFF_TEXT[d] }), h('span', { class: 'kc-dur', text: fmtDur(s.dur) })),
        h('b', { class: 'kc-title', text: s.title }),
        h('span', { class: 'kc-artist', text: s.artist || s.cat }),
        h('span', { class: 'kc-stars', 'aria-label': st + ' trên 3 sao' }, ...[0, 1, 2].map((i) => h('i', { class: i < st ? 'on' : '', text: '★' }))));
    }) : [h('p', { class: 'hint', text: 'Không có bài nào khớp. Thử bỏ bớt từ khóa.' })]));
    const chip = (text, on, fn) => h('button', { type: 'button', class: 'toggle', 'aria-pressed': String(on), text, onclick: fn });
    chips.replaceChildren(
      ...[['all', 'Mọi độ khó'], ['easy', 'Dễ'], ['mid', 'Vừa'], ['hard', 'Khó']].map(([k, t]) => chip(t, k === diff, () => { diff = k; paint(); })),
      h('span', { class: 'kho-sep' }),
      ...cats.map((c) => chip(c, c === cat, () => { cat = c; paint(); })));
  };
  search.addEventListener('input', paint);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = shown()[0]; if (f) openCatalogSong(f); } });
  body.replaceChildren(closeBtn(dlg), h('h3', { text: 'Kho bài' }),
    h('p', { class: 'sub', text: `Chọn một bài để chơi. Bạn đã có ${totalStars()} sao${streak() > 1 ? `, luyện ${streak()} ngày liên tiếp` : ''}!` }),
    h('div', { class: 'kho-bar' }, search, count), chips, rows,
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-ghost', text: 'Nhập File .mid từ máy', onclick: () => { dlg.close(); studio.pickFile(); } })));
  paint();
  if (!dlg.open) dlg.showModal();
  search.focus();
}

studio = createStudio({
  root: $('#studio-root'), h, hub, toast,
  onSongChange: (song) => { if (song) save(song); else { clearTimeout(saveTimer); curId = null; setCurrent(null); studio && studio.refreshRecent(); } },
  openDevice: () => openDlg('#dlg-device', buildDeviceDialog),
  openKho: () => buildKhoDialog(),
  adopt: adoptMidi,
  openSaved,
  recent: listSongs,
  meta: (id) => (catalog && id && id.startsWith('kho:') ? catalog.find((c) => 'kho:' + c.file === id) : null),
  stars: starsOf,
  noteLabel,
  acceptCh: (ch) => S.channels.includes(ch),
  download, slug,
});

// ======================= Đàn ở đáy màn hình =======================
const dock = createPianoDock({ root: $('#piano-dock'), hub, h, noteLabel, acceptCh: (ch) => S.channels.includes(ch) });

// ======================= Phím tắt =======================
const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      e.shiftKey ? studio.redo() : studio.undo();
    }
    return;
  }
  if (e.altKey || isTyping(e.target) || $('dialog[open]')) return;
  if (e.key === ' ') {
    if (e.target.tagName === 'BUTTON') return; // để nút tự nhận phím Space
    e.preventDefault();
    studio.togglePlay();
  }
});

// ======================= Nối dây giao diện =======================
hub.on('devices', renderDevice);
$('#btn-device').addEventListener('click', () => openDlg('#dlg-device', buildDeviceDialog));
$('#btn-settings').addEventListener('click', () => openDlg('#dlg-settings', buildSettingsDialog));
$$('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));
window.addEventListener('beforeunload', () => saveNow(studio.getSong()));
$('#foot-ver').textContent = 'v' + VERSION;
$('#foot-author').textContent = AUTHOR;
$('#foot-year').textContent = String(new Date().getFullYear());

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

// ======================= Hướng dẫn lần đầu + dọn bản lưu cũ =======================
for (const it of listSongs()) if (/^(piano|bài chưa đặt tên|untitled)$/i.test((it.title || '').trim())) deleteSong(it.id); // bản lưu cũ bị đặt tên theo track
function showGuide() {
  const dlg = h('dialog', { class: 'guide' });
  const steps = [
    ['Nối đàn', 'Cắm cáp USB vào cổng USB TO HOST của đàn rồi bật đàn. Trình duyệt hỏi quyền MIDI thì bấm Cho phép.'],
    ['Chọn bài', 'Bấm Chọn bài từ kho. Bài có chấm Dễ là hợp để bắt đầu.'],
    ['Đặt tay', 'Ngồi thẳng, đặt ngón cái tay phải lên nốt Đô giữa. Nốt vàng dành cho tay phải, nốt xanh dành cho tay trái.'],
    ['Vào chơi', 'Bấm VÀO CHƠI. Nốt rơi xuống phím nào thì bấm phím đó. Chơi đúng được sao!'],
  ];
  dlg.append(h('div', { class: 'dlg' }, h('h3', { text: 'Chào mừng đến Nốt Rơi!' }), h('p', { class: 'sub', text: 'Học đàn vui hơn chỉ với 4 bước:' }),
    h('ol', { class: 'guide-steps' }, ...steps.map(([t, d]) => h('li', {}, h('b', { text: t }), h('span', { text: d })))),
    h('div', { class: 'dlg-actions' }, h('button', { type: 'button', class: 'btn-primary big', text: 'Bắt đầu thôi!', onclick: () => dlg.close() }))));
  dlg.addEventListener('close', () => { try { localStorage.setItem('notroi.seen', '1'); } catch (e) { /* bỏ qua */ } dlg.remove(); });
  document.body.append(dlg);
  dlg.showModal();
}
try { if (!localStorage.getItem('notroi.seen')) setTimeout(showGuide, 400); } catch (e) { /* bỏ qua */ }

// ======================= Khởi động =======================
{
  const id = currentId();
  const song = id ? loadSong(id) : null;
  if (song) { curId = id; studio.show(song, song.title); }
}
hub.init().then(renderDevice);
loadCatalog().then(() => studio.refreshRecent()).catch(() => {}); // nạp kho sớm để Bài gần đây hiện được tác giả/thể loại

// Móc gỡ lỗi nhỏ: cho phép test tự động mà không cần đàn thật.
window.__hoaam = { dock, hub, studio, settings: S, adoptMidi };

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
installEvt = window.__bip || null; // index.html bắt sớm tín hiệu của Chrome, phòng khi nó bắn trước lúc app nạp xong
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
// Hộp thoại nhỏ của app: tiêu đề, lời nhắn, nút đồng ý (tùy chọn) và nút đóng.
function askDialog({ title, text, steps, extra, ok, onOk, cancel = 'Hủy' }) {
  const dlg = h('dialog', { class: 'guide small' });
  dlg.append(h('div', { class: 'dlg' }, h('h3', { text: title }), h('p', { class: 'sub', text }),
    extra || null,
    steps ? h('ol', { class: 'guide-steps' }, ...steps.map(([t, d]) => h('li', {}, h('b', { text: t }), h('span', { text: d })))) : null,
    h('div', { class: 'dlg-actions' },
      ok ? h('button', { type: 'button', class: 'btn-primary big', text: ok, onclick: () => { dlg.close(); onOk && onOk(); } }) : null,
      h('button', { type: 'button', class: 'btn-ghost big', text: cancel, onclick: () => dlg.close() }))));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
async function onInstallClick() {
  if (isInstalled()) { toast('Bạn đang dùng app từ lối tắt rồi.'); return; }
  if (installEvt) {
    askDialog({
      title: 'Tạo lối tắt Nốt Rơi ngoài màn hình?', text: 'Nốt Rơi sẽ có lối tắt ngoài desktop, mở toàn màn hình như một app. Sau khi bấm Tạo, Chrome sẽ hỏi xác nhận một lần nữa.', ok: 'Tạo lối tắt', cancel: 'Hủy',
      onOk: async () => { const e = installEvt; installEvt = null; e.prompt(); await e.userChoice.catch(() => {}); },
    });
    return;
  }
  let already = false;
  try { already = !!(navigator.getInstalledRelatedApps && (await navigator.getInstalledRelatedApps()).length); } catch (e) { /* bỏ qua */ }
  if (already) {
    askDialog({
      title: 'Bạn đã tạo lối tắt rồi', text: 'Nốt Rơi đã có trên máy này, mở lối tắt ngoài desktop để dùng. Muốn tạo lại cho đúng tên và biểu tượng mới:',
      steps: [['Gỡ bản cũ', 'Mở app, bấm menu ⋮ ở góc cửa sổ, chọn Gỡ cài đặt Nốt Rơi.'], ['Tạo lại', 'Mở web này trong tab Chrome thường rồi bấm Tạo lối tắt.']], cancel: 'Đã hiểu',
    });
    return;
  }
  // Chrome không đưa tín hiệu cho phép tạo lối tắt: kiểm tra từng điều kiện để biết vì sao.
  const checks = [];
  checks.push([/Chrome|Edg\//.test(navigator.userAgent) && !/OPR\//.test(navigator.userAgent), 'Đang dùng Chrome hoặc Edge']);
  checks.push([window.isSecureContext, 'Trang chạy qua https']);
  try { const r = await fetch('manifest.webmanifest', { cache: 'no-store' }); const m = await r.json(); checks.push([r.ok && !!(m.icons || []).length, 'File manifest và biểu tượng hợp lệ']); } catch (e) { checks.push([false, 'File manifest và biểu tượng hợp lệ']); }
  try { const reg = await navigator.serviceWorker.getRegistration(); checks.push([!!(reg && (reg.active || reg.waiting)), 'Service worker đang chạy']); } catch (e) { checks.push([false, 'Service worker đang chạy']); }
  const list = h('ul', { class: 'checks' }, ...checks.map(([ok, t]) => h('li', { class: ok ? 'ok' : 'bad', text: (ok ? '✓ ' : '✗ ') + t })));
  askDialog({
    title: 'Chrome chưa cho tạo lối tắt lúc này',
    text: 'Phần của app đã kiểm tra bên dưới. Nếu đều ✓ thì Chrome đang tự chặn, thường vì app đã được cài sẵn hoặc bạn từng bấm tắt hộp cài. Hãy nhìn bên phải thanh địa chỉ: có biểu tượng cài đặt (màn hình có mũi tên) thì bấm vào đó, hoặc menu ⋮ → Truyền, lưu và chia sẻ → Cài đặt Nốt Rơi.',
    extra: list, cancel: 'Đã hiểu',
  });
}
installBtn.addEventListener('click', onInstallClick);
const markDone = (on = true) => installBtn.classList.toggle('done', on);
window.addEventListener('appinstalled', () => { markDone(); toast('Đã tạo lối tắt Nốt Rơi ngoài màn hình.'); });
// Đã tạo lối tắt rồi (đang chạy từ lối tắt, hoặc Chrome báo app đã cài): làm tối nút.
(async () => {
  if (isInstalled()) { markDone(); return; }
  try { if (navigator.getInstalledRelatedApps && (await navigator.getInstalledRelatedApps()).length) markDone(); } catch (e) { /* bỏ qua */ }
})();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});

// ======================= Bản mới: bắt buộc cập nhật =======================
// Cứ 20 giây (và mỗi lần quay lại cửa sổ) hỏi máy chủ số phiên bản mới nhất. Có bản mới thì hiện hộp thoại không đóng được.
const verNum = (v) => v.split('.').map((x) => +x || 0);
const isNewer = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
let updateShown = false;
function showUpdate(ver) {
  if (updateShown) return;
  updateShown = true;
  studio.stop();
  saveNow(studio.getSong());
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  const dlg = h('dialog', { class: 'update-dlg', id: 'dlg-update' });
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // Esc không đóng được
  const status = h('p', { class: 'hint', text: '' });
  const go = h('button', { type: 'button', class: 'btn-primary big', text: 'Cập nhật ngay', onclick: async () => {
    go.disabled = true; go.textContent = 'Đang cập nhật...';
    status.textContent = 'Đang tải bản mới, vài giây thôi...';
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    } catch (e) { /* vẫn tải lại */ }
    // Địa chỉ có tham số ?u= nên máy chủ luôn trả index.html mới; trong đó css/js đã gắn số phiên bản nên cũng là bản mới.
    location.replace(location.pathname + '?u=' + Date.now());
  } });
  dlg.append(h('div', { class: 'dlg' },
    h('h3', { text: 'Có phiên bản mới' }),
    h('p', { class: 'sub', text: `Bạn đang dùng ${VERSION}, bản mới nhất là ${ver}. Cần cập nhật để tiếp tục dùng. Bài đang mở đã được lưu.` }),
    status,
    h('div', { class: 'dlg-actions' }, go)));
  document.body.append(dlg);
  dlg.showModal();
  go.focus();
}
async function checkUpdate() {
  try {
    const r = await fetch('js/version.js?t=' + Date.now(), { cache: 'no-store' });
    const m = /VERSION\s*=\s*'([\d.]+)'/.exec(await r.text());
    if (m && isNewer(m[1], VERSION)) showUpdate(m[1]);
  } catch (e) { /* mất mạng thì thôi, lần sau thử lại */ }
}
if (location.protocol !== 'file:') {
  setInterval(() => { if (!document.hidden) checkUpdate(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  window.addEventListener('focus', checkUpdate);
  checkUpdate();
}
window.__hoaam.checkUpdate = checkUpdate;
