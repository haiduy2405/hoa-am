// Hòa Âm: bộ máy âm nhạc thuần (không đụng DOM) để dùng chung cho app và test.

export const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
export const SOL_SHARP = ['Đô', 'Đô♯', 'Rê', 'Rê♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
export const SOL_FLAT = ['Đô', 'Rê♭', 'Rê', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

// lv: 0 = hiển thị ở chế độ đơn giản, 1 = chỉ chế độ đầy đủ (jazz)
export const TYPES = {
  maj: { suffix: '', tones: [0, 4, 7], lv: 0, alias: ['', 'M', 'maj', 'major'] },
  min: { suffix: 'm', tones: [0, 3, 7], lv: 0, alias: ['m', 'min', 'mi', '-', 'minor'] },
  dim: { suffix: 'dim', tones: [0, 3, 6], lv: 0, alias: ['dim', '°', 'o'] },
  aug: { suffix: 'aug', tones: [0, 4, 8], lv: 0, alias: ['aug', '+', '#5'] },
  sus2: { suffix: 'sus2', tones: [0, 2, 7], lv: 0, alias: ['sus2'] },
  sus4: { suffix: 'sus4', tones: [0, 5, 7], lv: 0, alias: ['sus4', 'sus'] },
  p5: { suffix: '5', tones: [0, 7], lv: 0, alias: ['5'] },
  six: { suffix: '6', tones: [0, 4, 7, 9], lv: 0, alias: ['6', 'maj6', 'M6'] },
  m6: { suffix: 'm6', tones: [0, 3, 7, 9], lv: 0, alias: ['m6', 'min6', '-6'] },
  dom7: { suffix: '7', tones: [0, 4, 7, 10], lv: 0, alias: ['7', 'dom7'] },
  maj7: { suffix: 'maj7', tones: [0, 4, 7, 11], lv: 0, alias: ['maj7', 'M7', 'Δ', 'Δ7', '△7', 'ma7', 'maj'] },
  m7: { suffix: 'm7', tones: [0, 3, 7, 10], lv: 0, alias: ['m7', 'min7', 'mi7', '-7'] },
  m7b5: { suffix: 'm7♭5', tones: [0, 3, 6, 10], lv: 0, alias: ['m7b5', 'ø', 'ø7', 'min7b5', '-7b5'] },
  dim7: { suffix: 'dim7', tones: [0, 3, 6, 9], lv: 0, alias: ['dim7', '°7', 'o7'] },
  add9: { suffix: 'add9', tones: [0, 2, 4, 7], lv: 0, alias: ['add9', 'add2', '2'] },
  mmaj7: { suffix: 'm(maj7)', tones: [0, 3, 7, 11], lv: 1, alias: ['mmaj7', 'mM7', 'm(maj7)', 'minmaj7', '-maj7'] },
  sus47: { suffix: '7sus4', tones: [0, 5, 7, 10], lv: 1, alias: ['7sus4', '7sus'] },
  madd9: { suffix: 'm(add9)', tones: [0, 2, 3, 7], lv: 1, alias: ['madd9', 'm(add9)', 'madd2'] },
  six9: { suffix: '6/9', tones: [0, 2, 4, 7, 9], lv: 1, alias: ['6/9', '69', '6add9'] },
  dom9: { suffix: '9', tones: [0, 2, 4, 7, 10], lv: 1, alias: ['9'] },
  maj9: { suffix: 'maj9', tones: [0, 2, 4, 7, 11], lv: 1, alias: ['maj9', 'M9', 'Δ9'] },
  m9: { suffix: 'm9', tones: [0, 2, 3, 7, 10], lv: 1, alias: ['m9', 'min9', '-9'] },
  dom11: { suffix: '11', tones: [0, 2, 4, 5, 7, 10], lv: 1, alias: ['11'] },
  m11: { suffix: 'm11', tones: [0, 2, 3, 5, 7, 10], lv: 1, alias: ['m11', 'min11'] },
  dom13: { suffix: '13', tones: [0, 2, 4, 7, 9, 10], lv: 1, alias: ['13'] },
  d7b9: { suffix: '7♭9', tones: [0, 1, 4, 7, 10], lv: 1, alias: ['7b9'] },
  d7s9: { suffix: '7♯9', tones: [0, 3, 4, 7, 10], lv: 1, alias: ['7#9'] },
  d7b5: { suffix: '7♭5', tones: [0, 4, 6, 10], lv: 1, alias: ['7b5'] },
  d7s5: { suffix: '7♯5', tones: [0, 4, 8, 10], lv: 1, alias: ['7#5', 'aug7', '+7'] },
};

export const QUICK_TYPES = ['maj', 'min', '7', 'maj7', 'm7', 'sus4', 'sus2', 'dim', 'aug', 'six', 'add9', 'm7b5']
  .map((t) => (t === '7' ? 'dom7' : t));

const MINORISH = new Set(['min', 'm6', 'm7', 'mmaj7', 'm7b5', 'dim', 'dim7', 'madd9', 'm9', 'm11']);
export const isMinorish = (type) => MINORISH.has(type);

const mod12 = (n) => ((n % 12) + 12) % 12;

// ---------- Tên nốt & cách viết ----------

export function autoFlat(chord) {
  if (!chord) return false;
  const r = chord.root;
  if (isMinorish(chord.type)) return [2, 7, 0, 5, 10, 3].includes(r);
  return [5, 10, 3, 8, 1].includes(r);
}

export function keyFlat(key) {
  if (!key) return false;
  return key.mode === 'minor' ? [2, 7, 0, 5, 10, 3].includes(key.tonic) : [5, 10, 3, 8, 1].includes(key.tonic);
}

// true = dùng dấu giáng, false = dấu thăng, null = tông không có dấu hóa (để từng hợp âm tự quyết)
export function keySpelling(key) {
  if (!key) return null;
  const t = key.tonic;
  if (key.mode === 'major') {
    if ([5, 10, 3, 8, 1].includes(t)) return true;
    if ([7, 2, 9, 4, 11, 6].includes(t)) return false;
    return null;
  }
  if ([2, 7, 0, 5, 10, 3].includes(t)) return true;
  if ([4, 11, 6, 1, 8].includes(t)) return false;
  return null;
}

export function noteName(pc, { flat = false, solfege = false } = {}) {
  const t = solfege ? (flat ? SOL_FLAT : SOL_SHARP) : flat ? FLAT : SHARP;
  return t[mod12(pc)];
}

// Trả về phần rời để UI dựng chữ gốc to, hậu tố nhỏ, bass phụ.
export function chordParts(chord, { flat, transpose = 0 } = {}) {
  const c = transposeChord(chord, transpose);
  const f = flat == null ? autoFlat(c) : flat;
  return {
    root: noteName(c.root, { flat: f }),
    suffix: TYPES[c.type].suffix,
    bass: c.bass != null ? noteName(c.bass, { flat: f }) : null,
  };
}

export function chordText(chord, opts) {
  const p = chordParts(chord, opts);
  return p.root + p.suffix + (p.bass ? '/' + p.bass : '');
}

export function transposeChord(chord, n) {
  if (!n) return chord;
  return { root: mod12(chord.root + n), type: chord.type, bass: chord.bass != null ? mod12(chord.bass + n) : null };
}

export const chordKey = (c) => `${c.root}.${c.type}.${c.bass ?? ''}`;
export const sameChord = (a, b) => !!a && !!b && chordKey(a) === chordKey(b);

export function chordPcs(chord) {
  return TYPES[chord.type].tones.map((i) => mod12(chord.root + i));
}

// ---------- Nhận diện hợp âm ----------

export function detect(midiNotes, { level = 0 } = {}) {
  const notes = [...new Set(midiNotes)].sort((a, b) => a - b);
  const empty = { notes, pcs: [], bass: null, candidates: [], kind: 'none' };
  if (!notes.length) return empty;
  const pcs = [...new Set(notes.map((n) => n % 12))];
  const bass = notes[0] % 12;
  const base = { notes, pcs, bass };
  if (pcs.length === 1) return { ...base, candidates: [], kind: 'single' };

  if (pcs.length === 2) {
    const other = pcs.find((p) => p !== bass);
    const iv = mod12(other - bass);
    if (iv === 7) return { ...base, kind: 'power', candidates: [{ root: bass, type: 'p5', bass: null, score: 30 }] };
    if (iv === 5) return { ...base, kind: 'power', candidates: [{ root: other, type: 'p5', bass, score: 26 }] };
    return { ...base, candidates: [], kind: 'dyad' };
  }

  const out = [];
  for (const root of pcs) {
    const rel = new Set(pcs.map((p) => mod12(p - root)));
    for (const [id, t] of Object.entries(TYPES)) {
      if (id === 'p5' || t.lv > level) continue;
      const S = t.tones;
      const missing = S.filter((i) => !rel.has(i));
      const extra = [...rel].filter((i) => !S.includes(i));
      const okMissing = missing.every((i) => (i === 7 && S.length >= 4) || (i === 2 && S.length >= 6));
      if (!okMissing || extra.length > 2) continue;
      const matched = S.length - missing.length;
      let score = matched * 10 - extra.length * 9;
      if (missing.includes(7)) score -= 2.5;
      if (missing.includes(2)) score -= 1.5;
      if (!extra.length && !missing.length) score += 6;
      if (bass === root) score += 4;
      else if (S.includes(mod12(bass - root))) score += 0.5;
      else score -= 1;
      score -= 0.15 * S.length + (t.lv ? 1 : 0);
      if (score < 12) continue;
      out.push({ root, type: id, bass: bass === root ? null : bass, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return { ...base, candidates: out.slice(0, 4), kind: out.length ? 'chord' : 'cluster' };
}

// ---------- Đọc chữ hợp âm ----------

const ALIAS = new Map();
for (const [id, t] of Object.entries(TYPES)) {
  for (const a of t.alias) {
    const k = norm(a);
    if (!ALIAS.has(k)) ALIAS.set(k, id);
  }
}
ALIAS.set('', 'maj');

function norm(s) {
  return s.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/[()\s]/g, '');
}

const ROOT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function parseNote(s) {
  const m = /^([A-Ga-g])([#b♯♭]?)/.exec(s);
  if (!m) return null;
  let pc = ROOT_PC[m[1].toUpperCase()];
  if (m[2] === '#' || m[2] === '♯') pc += 1;
  if (m[2] === 'b' || m[2] === '♭') pc -= 1;
  return { pc: mod12(pc), len: m[0].length };
}

export function parseChord(str) {
  if (!str) return null;
  let s = str.trim();
  const slash = /\/([A-Ga-g][#b♯♭]?)$/.exec(s);
  let bass = null;
  if (slash) {
    const b = parseNote(slash[1]);
    if (b) {
      bass = b.pc;
      s = s.slice(0, slash.index);
    }
  }
  const r = parseNote(s);
  if (!r) return null;
  const type = ALIAS.get(norm(s.slice(r.len)));
  if (!type) return null;
  return { root: r.pc, type, bass: bass === r.pc ? null : bass };
}

// ---------- Tông & số La Mã ----------

const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

// chords: [{chord, weight}] theo thứ tự thời gian
export function detectKey(chords) {
  if (!chords.length) return null;
  const hist = new Array(12).fill(0);
  for (const { chord, weight = 1 } of chords) {
    const pcs = chordPcs(chord);
    pcs.forEach((p, i) => (hist[p] += weight * (i === 0 ? 2 : 1)));
    if (chord.bass != null) hist[chord.bass] += weight * 0.5;
  }
  const first = chords[0].chord;
  const last = chords[chords.length - 1].chord;
  const scored = [];
  for (let t = 0; t < 12; t++) {
    const rot = (prof) => prof.map((_, i) => prof[mod12(i - t)]);
    for (const mode of ['major', 'minor']) {
      let s = pearson(hist, rot(mode === 'major' ? KS_MAJOR : KS_MINOR));
      const tonicChord = (c) => c.root === t && (mode === 'minor' ? isMinorish(c.type) : !isMinorish(c.type));
      if (tonicChord(last)) s += 0.06;
      if (tonicChord(first)) s += 0.04;
      scored.push({ tonic: t, mode, score: s });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const gap = scored[0].score - scored[1].score;
  let confidence = 'low';
  if (chords.length >= 3) confidence = gap > 0.08 ? 'high' : gap > 0.03 ? 'mid' : 'low';
  return { ...scored[0], alt: scored[1], confidence };
}

export function keyName(key, { solfege = true } = {}) {
  const f = keyFlat(key);
  const n = noteName(key.tonic, { flat: f, solfege });
  return solfege ? `${n} ${key.mode === 'major' ? 'trưởng' : 'thứ'}` : n + (key.mode === 'minor' ? 'm' : '');
}

const ROMAN_BASE = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];
const ROMAN_SUF = {
  maj: '', min: '', dim: '°', aug: '+', sus2: 'sus2', sus4: 'sus4', p5: '5', six: '6', m6: '6', dom7: '7', maj7: 'maj7',
  m7: '7', mmaj7: 'maj7', m7b5: 'ø7', dim7: '°7', sus47: '7sus4', add9: 'add9', madd9: 'add9', six9: '6/9', dom9: '9',
  maj9: 'maj9', m9: '9', dom11: '11', m11: '11', dom13: '13', d7b9: '7♭9', d7s9: '7♯9', d7b5: '7♭5', d7s5: '7♯5',
};

export function roman(chord, key) {
  if (!key) return null;
  let base = ROMAN_BASE[mod12(chord.root - key.tonic)];
  if (isMinorish(chord.type)) base = base.toLowerCase();
  return { base, suffix: ROMAN_SUF[chord.type] };
}

const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10, 11] };
export function inKey(chord, key) {
  if (!key) return true;
  const set = new Set(SCALE[key.mode].map((i) => mod12(key.tonic + i)));
  return chordPcs(chord).every((p) => set.has(p));
}

// ---------- Gợi ý hợp âm kế tiếp ----------

const DEG = {
  major: {
    offs: [0, 2, 4, 5, 7, 9, 11],
    tri: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
    sev: ['maj7', 'm7', 'm7', 'maj7', 'dom7', 'm7', 'm7b5'],
    next: { 1: [4, 5, 6, 2, 3], 2: [5, 7, 4], 3: [6, 4, 2], 4: [5, 1, 2, 6, 3], 5: [1, 6, 4, 3], 6: [4, 2, 5, 3, 1], 7: [1, 3] },
  },
  minor: {
    offs: [0, 2, 3, 5, 7, 8, 10],
    tri: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
    sev: ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', 'dom7'],
    next: { 1: [4, 7, 6, 5, 3], 2: [5, 1], 3: [7, 4, 6, 1], 4: [5, 1, 7, 6], 5: [1, 6, 4], 6: [7, 5, 4, 1, 3], 7: [3, 1, 6, 4] },
  },
};

const REASON = {
  major: {
    1: 'Về chủ âm, khép câu',
    2: 'Chuẩn bị về dominant',
    3: 'Mềm, chuyển sang sắc thái buồn',
    4: 'Mở rộng, êm và sáng',
    5: 'Dominant, kéo mạnh về chủ âm',
    6: 'Buồn hơn, rất hay đi sau I',
    7: 'Căng, cần giải về I',
  },
  minor: {
    1: 'Về chủ âm, khép câu',
    2: 'Căng, dẫn vào dominant',
    3: 'Sáng lên, mượn sắc trưởng',
    4: 'Sâu hơn, giữ nét buồn',
    5: 'Dominant, kéo về chủ âm',
    6: 'Rộng, đầy cảm xúc',
    7: 'Bước đệm quen thuộc',
  },
};

export function suggestNext(last, key, { sevenths = false } = {}) {
  if (!key) return [];
  const D = DEG[key.mode];
  const use7 = sevenths || (last && ['dom7', 'maj7', 'm7', 'm7b5', 'dim7', 'dom9', 'maj9', 'm9'].includes(last.type));
  const build = (deg, forceType) => {
    const root = mod12(key.tonic + D.offs[deg - 1]);
    const type = forceType || (use7 ? D.sev : D.tri)[deg - 1];
    return { root, type, bass: null };
  };
  let degs = [];
  const idx = last ? D.offs.findIndex((o) => mod12(key.tonic + o) === last.root) : 0;
  if (idx >= 0) degs = D.next[idx + 1];
  else degs = [5, 1, 4];
  const out = [];
  const seen = new Set();
  const push = (chord, reason, tag) => {
    const k = chordKey(chord);
    if (seen.has(k) || (last && sameChord(last, chord))) return;
    seen.add(k);
    out.push({ chord, reason, tag, roman: roman(chord, key) });
  };
  for (const d of degs) {
    push(build(d), REASON[key.mode][d], 'diatonic');
    if (key.mode === 'major' && d === 5) push(build(5, 'dom7'), 'Dominant 7, kéo về chủ âm mạnh hơn', 'diatonic');
    if (key.mode === 'minor' && d === 5) push(build(5, 'dom7'), 'Dominant 7 (hòa âm), kéo về chủ âm', 'color');
  }
  if (key.mode === 'major') {
    push({ root: mod12(key.tonic + 10), type: 'maj', bass: null }, 'Mượn ♭VII, màu rock và pop', 'color');
    push({ root: mod12(key.tonic + 5), type: 'min', bass: null }, 'Mượn iv, màu da diết', 'color');
  } else {
    push({ root: mod12(key.tonic + 5), type: 'maj', bass: null }, 'Mượn IV, ánh sáng bất ngờ', 'color');
  }
  return out.slice(0, 7);
}

// ---------- Voicing (để nghe lại) ----------

export function voiceChord(chord, prevNotes = null) {
  const pcs = chordPcs(chord);
  const bassPc = chord.bass != null ? chord.bass : chord.root;
  const bass = 36 + bassPc;
  const centre = prevNotes && prevNotes.length > 1 ? prevNotes.slice(1).reduce((a, b) => a + b, 0) / (prevNotes.length - 1) : 62;
  const upper = [];
  for (const pc of pcs) {
    let best = null;
    for (let n = 50; n <= 79; n++) {
      if (n % 12 !== pc) continue;
      if (best == null || Math.abs(n - centre) < Math.abs(best - centre)) best = n;
    }
    if (best != null) upper.push(best);
  }
  upper.sort((a, b) => a - b);
  return [bass, ...new Set(upper)];
}
