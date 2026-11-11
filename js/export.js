import { chordText, keySpelling, keyName, transposeChord, voiceChord } from './engine.js';
import { barChords, sortedEvents, totalBars } from './model.js';

export function projectToText(P, { perRow = 4, key = null } = {}) {
  const T = P.transpose || 0;
  const tKey = key ? { tonic: (key.tonic + T + 120) % 12, mode: key.mode } : null;
  const flat = tKey ? keySpelling(tKey) : null;
  const lines = [];
  lines.push((P.title || 'Bài chưa đặt tên').trim());
  const meta = [];
  if (tKey) meta.push('Tông: ' + keyName(tKey, { solfege: false }) + ' (' + keyName(tKey) + ')');
  meta.push(`Nhịp: ${P.beats}/4`, `Tempo: ${P.bpm} BPM`);
  if (T) meta.push(`Chuyển tông: ${T > 0 ? '+' : ''}${T}`);
  lines.push(meta.join('   '), '');
  const bars = totalBars(P, perRow);
  const rows = bars / perRow;
  let lastRowWithContent = 0;
  for (let r = 0; r < rows; r++) {
    const has = Array.from({ length: perRow }, (_, b) => barChords(P, r * perRow + b)).some((x) => x.chords.length);
    if (has || (P.rows[r] && (P.rows[r].lyrics || P.rows[r].label))) lastRowWithContent = r;
  }
  for (let r = 0; r <= lastRowWithContent; r++) {
    const meta = P.rows[r] || {};
    if (meta.label) lines.push(`[${meta.label}]`);
    const cells = [];
    for (let b = 0; b < perRow; b++) {
      const { chords, carry } = barChords(P, r * perRow + b);
      if (chords.length) cells.push(chords.map((c) => chordText(c.ev.chord, { flat, transpose: T })).join(' '));
      else cells.push(carry ? '%' : '-');
    }
    lines.push('| ' + cells.join(' | ') + ' |');
    if (meta.lyrics) lines.push(meta.lyrics.trim());
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// ---------- MIDI (SMF format 0) ----------

const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];

export function buildMidi(P) {
  const PPQ = 480;
  const T = P.transpose || 0;
  const ev = sortedEvents(P);
  const trk = [];
  const meta = (delta, type, data) => trk.push(...vlq(delta), 0xff, type, ...vlq(data.length), ...data);
  const name = Array.from(new TextEncoder().encode(P.title || 'Hoa Am'));
  meta(0, 0x03, name);
  const mpq = Math.round(60000000 / P.bpm);
  meta(0, 0x51, [(mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255]);
  meta(0, 0x58, [P.beats, 2, 24, 8]);

  const end = Math.ceil(((ev.length ? ev[ev.length - 1].beat : 0) + 0.001) / P.beats) * P.beats;
  const items = [];
  let prev = null;
  ev.forEach((e, i) => {
    const notes = voiceChord(transposeChord(e.chord, T), prev);
    prev = notes;
    const stop = (ev[i + 1] ? ev[i + 1].beat : end) * PPQ;
    notes.forEach((n) => {
      items.push({ t: Math.round(e.beat * PPQ), d: [0x90, n, 84] });
      items.push({ t: Math.round(stop - 8), d: [0x80, n, 0] });
    });
  });
  items.sort((a, b) => a.t - b.t || (a.d[0] === 0x80 ? -1 : 1));
  let cur = 0;
  for (const it of items) {
    trk.push(...vlq(it.t - cur), ...it.d);
    cur = it.t;
  }
  trk.push(...vlq(0), 0xff, 0x2f, 0x00);
  return Uint8Array.from([
    ...Array.from('MThd', (c) => c.charCodeAt(0)), ...u32(6), ...u16(0), ...u16(1), ...u16(PPQ),
    ...Array.from('MTrk', (c) => c.charCodeAt(0)), ...u32(trk.length), ...trk,
  ]);
}

// ---------- Tiện ích trình duyệt ----------

export function download(filename, data, type) {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export const slug = (s) =>
  (s || 'hoa-am').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hoa-am';
