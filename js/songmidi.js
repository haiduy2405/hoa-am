// Đọc và ghi file MIDI chuẩn (SMF), thao tác trên bản nhạc MIDI, trích hợp âm từ nốt.
// Hàm thuần, không đụng DOM, để dùng chung cho app và test.

import { detect, transposeChord, voiceChord } from './engine.js';

export const GM = [
  'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass and Lead',
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain', 'Soundtrack', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-Fi',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

// Kiểu âm khi phát bằng trình duyệt (synth đơn giản). Phát qua đàn thì dùng âm thật của đàn.
export function kindFor(program, channel) {
  if (channel === 9) return 'drum';
  if (program >= 32 && program <= 39) return 'bass';
  if (program <= 15 || (program >= 24 && program <= 31) || (program >= 104 && program <= 119)) return 'pluck';
  if ((program >= 72 && program <= 87)) return 'lead';
  return 'sustain';
}

let _id = 1;
export const nid = () => _id++;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Dựng đối tượng bản nhạc ----------

export function makeSong(raw) {
  const song = {
    ppq: raw.ppq || 480,
    title: raw.title || '',
    tempos: (raw.tempos || [[0, 120]]).map((t) => (Array.isArray(t) ? { tick: t[0], bpm: t[1] } : { ...t })),
    sigs: (raw.sigs || [[0, 4, 4]]).map((s) => (Array.isArray(s) ? { tick: s[0], num: s[1], den: s[2] } : { ...s })),
    parts: (raw.parts || []).map((p) => ({
      id: p.id || nid(),
      name: p.name || '',
      channel: p.channel ?? 0,
      program: p.program ?? 0,
      vol: p.vol ?? null,
      pan: p.pan ?? null,
      notes: (p.notes || []).map((n) => (Array.isArray(n) ? { t: n[0], d: n[1], n: n[2], v: n[3] } : { ...n })),
      ctl: p.ctl || [],
    })),
  };
  song.tempos.sort((a, b) => a.tick - b.tick);
  if (!song.tempos.length || song.tempos[0].tick > 0) song.tempos.unshift({ tick: 0, bpm: song.tempos[0] ? song.tempos[0].bpm : 120 });
  song.sigs.sort((a, b) => a.tick - b.tick);
  if (!song.sigs.length) song.sigs.push({ tick: 0, num: 4, den: 4 });
  Object.defineProperty(song, 'toJSON', { value: () => serializeSong(song), enumerable: false });
  return song;
}

export function serializeSong(s) {
  return {
    v: 1, ppq: s.ppq, title: s.title || '',
    tempos: s.tempos.map((t) => [t.tick, Math.round(t.bpm * 1000) / 1000]),
    sigs: s.sigs.map((x) => [x.tick, x.num, x.den]),
    parts: s.parts.map((p) => ({
      name: p.name, channel: p.channel, program: p.program, vol: p.vol, pan: p.pan,
      notes: p.notes.map((n) => [n.t, n.d, n.n, n.v]), ctl: p.ctl,
    })),
  };
}

export function deserializeSong(o) {
  if (!o || !Array.isArray(o.parts)) throw new Error('Dữ liệu MIDI không hợp lệ');
  return makeSong(o);
}

export function newSong({ bpm = 100, num = 4, ppq = 480 } = {}) {
  return makeSong({
    ppq, tempos: [[0, bpm]], sigs: [[0, num, 4]],
    parts: [{ name: 'Piano', channel: 0, program: 0, notes: [], ctl: [] }],
  });
}

// ---------- Đọc file ----------

export function parseMidi(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[p + i]); p += n; return s; };
  const u32 = () => ((u8[p++] << 24) | (u8[p++] << 16) | (u8[p++] << 8) | u8[p++]) >>> 0;
  const u16 = () => (u8[p++] << 8) | u8[p++];
  if (u8.length < 14 || str(4) !== 'MThd') throw new Error('Đây không phải file MIDI (thiếu phần đầu MThd).');
  const hlen = u32();
  const format = u16();
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('File dùng mốc thời gian SMPTE, app chưa hỗ trợ.');
  p = 8 + hlen;
  const ppq = division || 480;

  const tempos = [];
  const sigs = [];
  const parts = [];
  let title = '';
  let total = 0;
  const dec = new TextDecoder('utf-8');

  for (let tr = 0; tr < ntrks && p < u8.length; tr++) {
    const id = str(4);
    const len = u32();
    const end = Math.min(u8.length, p + len);
    if (id !== 'MTrk') { p = end; continue; }
    let tick = 0, run = 0, trackName = '';
    const chans = new Map();
    const part = (ch) => {
      if (!chans.has(ch)) chans.set(ch, { channel: ch, program: null, vol: null, pan: null, notes: [], ctl: [], open: new Map() });
      return chans.get(ch);
    };
    const vlq = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while ((b & 0x80) && p < end); return v >>> 0; };
    while (p < end) {
      tick += vlq();
      let st;
      if (u8[p] < 0x80) st = run;
      else { st = u8[p++]; if (st < 0xf0) run = st; }
      if (st === 0xff) {
        const type = u8[p++];
        const n = vlq();
        const data = u8.subarray(p, p + n);
        p += n;
        if (type === 0x03 && !trackName) trackName = dec.decode(data).replace(/\0/g, '').trim();
        else if (type === 0x51 && n === 3) tempos.push({ tick, bpm: 60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]) });
        else if (type === 0x58 && n >= 2) sigs.push({ tick, num: data[0], den: 2 ** data[1] });
        else if (type === 0x2f) { p = end; }
      } else if (st === 0xf0 || st === 0xf7) {
        p += vlq();
      } else if (st >= 0x80) {
        const type = st & 0xf0;
        const ch = st & 0x0f;
        const d1 = u8[p++];
        const d2 = type === 0xc0 || type === 0xd0 ? 0 : u8[p++];
        const pt = part(ch);
        if (type === 0x90 && d2 > 0) {
          const k = d1;
          if (!pt.open.has(k)) pt.open.set(k, []);
          pt.open.get(k).push({ t: tick, v: d2 });
        } else if (type === 0x80 || type === 0x90) {
          const q = pt.open.get(d1);
          if (q && q.length) {
            const s = q.shift();
            pt.notes.push({ t: s.t, d: Math.max(1, tick - s.t), n: d1, v: s.v });
            total++;
          }
        } else if (type === 0xc0) {
          if (pt.program == null) pt.program = d1;
          else pt.ctl.push([tick, 0xc0, d1, 0]);
        } else if (type === 0xb0 && d1 === 7 && pt.vol == null && tick === 0) pt.vol = d2;
        else if (type === 0xb0 && d1 === 10 && pt.pan == null && tick === 0) pt.pan = d2;
        else pt.ctl.push([tick, type, d1, d2]);
        if (total > 200000) throw new Error('File quá lớn để chỉnh sửa trong trình duyệt.');
      } else {
        p++; // byte lạ, bỏ qua để không kẹt vòng lặp
      }
    }
    p = end;
    if (tr === 0 && !title && trackName) title = trackName;
    for (const pt of chans.values()) {
      for (const [k, q] of pt.open) for (const s of q) pt.notes.push({ t: s.t, d: Math.max(1, ppq), n: k, v: s.v });
      if (!pt.notes.length) continue;
      pt.notes.sort((a, b) => a.t - b.t || a.n - b.n);
      const prog = pt.program ?? 0;
      parts.push({
        name: trackName || (pt.channel === 9 ? 'Trống' : GM[prog]),
        channel: pt.channel, program: prog, vol: pt.vol, pan: pt.pan, notes: pt.notes, ctl: pt.ctl,
      });
    }
  }
  if (!parts.length) throw new Error('File MIDI này không có nốt nào.');
  // Tên track thường là tên bài ở track đầu, không dùng làm tên nhạc cụ khi đó
  if (format === 1 && parts.length > 1 && title && parts[0].name === title) parts[0].name = parts[0].channel === 9 ? 'Trống' : GM[parts[0].program];
  return makeSong({ ppq, title, tempos, sigs, parts });
}

// ---------- Ghi file ----------

const vlqBytes = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32b = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16b = (n) => [(n >> 8) & 255, n & 255];

function trackBytes(events) {
  events.sort((a, b) => a.t - b.t || a.r - b.r);
  const out = [];
  let cur = 0;
  for (const e of events) {
    out.push(...vlqBytes(Math.max(0, e.t - cur)), ...e.b);
    cur = e.t;
  }
  out.push(0, 0xff, 0x2f, 0);
  return out;
}

const metaText = (type, s) => {
  const d = Array.from(new TextEncoder().encode(s));
  return [0xff, type, ...vlqBytes(d.length), ...d];
};

export function writeMidi(song) {
  const chunks = [];
  const cond = [{ t: 0, r: 0, b: metaText(0x03, song.title || 'Hoa Am') }];
  for (const t of song.tempos) {
    const mpq = Math.round(60000000 / t.bpm);
    cond.push({ t: t.tick, r: 0, b: [0xff, 0x51, 3, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255] });
  }
  for (const s of song.sigs) cond.push({ t: s.tick, r: 0, b: [0xff, 0x58, 4, s.num, Math.round(Math.log2(s.den)), 24, 8] });
  chunks.push(trackBytes(cond));
  for (const part of song.parts) {
    const ev = [{ t: 0, r: 0, b: metaText(0x03, part.name || 'Track') }];
    const ch = part.channel & 15;
    if (part.vol != null) ev.push({ t: 0, r: 0, b: [0xb0 | ch, 7, part.vol] });
    if (part.pan != null) ev.push({ t: 0, r: 0, b: [0xb0 | ch, 10, part.pan] });
    ev.push({ t: 0, r: 0, b: [0xc0 | ch, part.program & 127] });
    for (const c of part.ctl) {
      const type = c[1];
      ev.push({ t: c[0], r: 0, b: type === 0xc0 || type === 0xd0 ? [type | ch, c[2]] : [type | ch, c[2], c[3]] });
    }
    for (const n of part.notes) {
      ev.push({ t: n.t, r: 2, b: [0x90 | ch, n.n, clamp(n.v, 1, 127)] });
      ev.push({ t: n.t + n.d, r: 1, b: [0x80 | ch, n.n, 0] });
    }
    chunks.push(trackBytes(ev));
  }
  const out = [...Array.from('MThd', (c) => c.charCodeAt(0)), ...u32b(6), ...u16b(1), ...u16b(chunks.length), ...u16b(song.ppq)];
  for (const c of chunks) out.push(...Array.from('MTrk', (ch) => ch.charCodeAt(0)), ...u32b(c.length), ...c);
  return Uint8Array.from(out);
}

// ---------- Thời gian ----------

export function makeClock(song) {
  const ppq = song.ppq;
  const pts = [];
  let ms = 0;
  song.tempos.forEach((t, i) => {
    if (i > 0) ms += ((t.tick - song.tempos[i - 1].tick) * 60000) / (song.tempos[i - 1].bpm * ppq);
    pts.push({ tick: t.tick, ms, bpm: t.bpm });
  });
  const at = (arr, key, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m][key] <= v) lo = m; else hi = m - 1; } return arr[lo]; };
  return {
    tickToMs: (tick) => { const q = at(pts, 'tick', tick); return q.ms + ((tick - q.tick) * 60000) / (q.bpm * ppq); },
    msToTick: (m) => { const q = at(pts, 'ms', m); return q.tick + (Math.max(0, m - q.ms) * q.bpm * ppq) / 60000; },
  };
}

export const songEnd = (song) => {
  let e = 0;
  for (const p of song.parts) for (const n of p.notes) if (n.t + n.d > e) e = n.t + n.d;
  return e;
};

// Số phách (nốt đen) trong một ô nhịp theo nhịp đầu tiên của bài.
export const barBeats = (song) => {
  const s = song.sigs[0] || { num: 4, den: 4 };
  return (s.num * 4) / s.den;
};

export const freeChannel = (song) => {
  const used = new Set(song.parts.map((p) => p.channel));
  for (let c = 0; c < 16; c++) if (c !== 9 && !used.has(c)) return c;
  return 0;
};

// ---------- Thao tác trên nốt ----------

export function transposeNotes(notes, semis) {
  for (const n of notes) n.n = clamp(n.n + semis, 0, 127);
}

export function quantizeNotes(notes, grid, { ends = false } = {}) {
  for (const n of notes) {
    n.t = Math.max(0, Math.round(n.t / grid) * grid);
    if (ends) n.d = Math.max(grid, Math.round(n.d / grid) * grid);
  }
}

export function scaleTempo(song, bpm) {
  const ratio = bpm / song.tempos[0].bpm;
  for (const t of song.tempos) t.bpm = Math.max(20, Math.min(300, t.bpm * ratio));
}

// ---------- Lấy hợp âm từ nốt ----------

// unitBeats: độ dài mỗi lần "nghe" tính theo phách (nốt đen). Trả về [{beat, chord}] chỉ gồm chỗ hợp âm đổi.
export function extractChords(song, { partIds, unitBeats = 4, level = 0 }) {
  const ppq = song.ppq;
  const unit = Math.max(1, Math.round(unitBeats * ppq));
  const parts = song.parts.filter((p) => partIds.includes(p.id) && p.channel !== 9);
  const notes = parts.flatMap((p) => p.notes).sort((a, b) => a.t - b.t);
  const end = songEnd(song);
  const out = [];
  let prev = null;
  let maxDur = 0;
  for (const n of notes) if (n.d > maxDur) maxDur = n.d;
  let from = 0;
  for (let s = 0; s < end; s += unit) {
    const e = s + unit;
    while (from < notes.length && notes[from].t + maxDur < s) from++;
    const byPitch = new Map();
    for (let i = from; i < notes.length && notes[i].t < e; i++) {
      const n = notes[i];
      const ov = Math.min(e, n.t + n.d) - Math.max(s, n.t);
      if (ov > 0) byPitch.set(n.n, (byPitch.get(n.n) || 0) + ov);
    }
    const pcW = new Array(12).fill(0);
    for (const [pitch, w] of byPitch) pcW[pitch % 12] += w;
    const maxW = Math.max(...pcW);
    if (maxW <= 0) continue;
    const need = Math.max(0.12 * unit, 0.15 * maxW);
    const picked = new Map(); // pc -> pitch thấp nhất đủ trọng số
    let bass = null;
    for (const [pitch, w] of byPitch) {
      if (w < 0.1 * unit && pcW[pitch % 12] < need) continue;
      if (pcW[pitch % 12] < need) continue;
      const cur = picked.get(pitch % 12);
      if (cur == null || pitch < cur) picked.set(pitch % 12, pitch);
      if (w >= 0.15 * unit && (bass == null || pitch < bass)) bass = pitch;
    }
    if (bass != null) picked.set(bass % 12, Math.min(bass, picked.get(bass % 12) ?? bass));
    if (picked.size < 3) continue;
    const res = detect([...picked.values()], { level });
    const top = res.candidates[0];
    if (!top) continue;
    const chord = { root: top.root, type: top.type, bass: top.bass };
    if (prev && prev.root === chord.root && prev.type === chord.type && prev.bass === chord.bass) continue;
    prev = chord;
    out.push({ beat: s / ppq, chord });
  }
  return out;
}

// Biến dãy hợp âm của bài thành một track MIDI (để ghép vào bản nhạc).
export function partFromChords(events, { ppq, beats, transpose = 0, name = 'Hợp âm', channel = 0, program = 0 }) {
  const ev = [...events].sort((a, b) => a.beat - b.beat);
  if (!ev.length) return null;
  const end = Math.ceil((ev[ev.length - 1].beat + 0.001) / beats) * beats;
  const notes = [];
  let prev = null;
  ev.forEach((e, i) => {
    const v = voiceChord(transposeChord(e.chord, transpose), prev);
    prev = v;
    const t = Math.round(e.beat * ppq);
    const stop = Math.round((ev[i + 1] ? ev[i + 1].beat : end) * ppq);
    v.forEach((n, k) => notes.push({ t, d: Math.max(1, stop - t - 4), n, v: k === 0 ? 90 : 76 }));
  });
  return { id: nid(), name, channel, program, vol: null, pan: null, notes, ctl: [] };
}
