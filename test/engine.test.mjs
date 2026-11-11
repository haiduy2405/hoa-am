import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect, chordText, parseChord, TYPES, detectKey, roman, suggestNext, voiceChord, keyName, inKey, transposeChord } from '../js/engine.js';
import { buildMidi, projectToText } from '../js/export.js';

const top = (notes, opts) => {
  const r = detect(notes, opts);
  return r.candidates[0] ? chordText(r.candidates[0]) : r.kind;
};

test('triads and inversions', () => {
  assert.equal(top([60, 64, 67]), 'C');
  assert.equal(top([57, 60, 64]), 'Am');
  assert.equal(top([52, 60, 67]), 'C/E');
  assert.equal(top([55, 60, 64]), 'C/G');
  assert.equal(top([62, 65, 69]), 'Dm');
  assert.equal(top([59, 62, 65]), 'Bdim');
  assert.equal(top([60, 65, 67]), 'Csus4');
  assert.equal(top([60, 64, 68]), 'Caug');
});

test('seventh chords', () => {
  assert.equal(top([55, 59, 62, 65]), 'G7');
  assert.equal(top([60, 64, 67, 71]), 'Cmaj7');
  assert.equal(top([50, 53, 57, 60]), 'Dm7');
  assert.equal(top([54, 57, 60, 64]), 'F♯m7♭5');
  assert.equal(top([57, 60, 63, 66]), 'Adim7');
  assert.equal(top([48, 52, 55, 57]), 'C6');
  assert.equal(top([45, 48, 52, 55]), 'Am7');
});

test('power chord and degraded input', () => {
  assert.equal(top([40, 47]), 'E5');
  assert.equal(detect([60]).kind, 'single');
  assert.equal(detect([60, 63]).kind, 'dyad');
  assert.equal(detect([]).kind, 'none');
});

test('extended chords only in full mode', () => {
  const n = [60, 64, 67, 71, 74];
  assert.equal(top(n, { level: 1 }), 'Cmaj9');
  assert.notEqual(top(n, { level: 0 }), 'Cmaj9');
  assert.equal(top([60, 64, 67, 70, 74], { level: 1 }), 'C9');
});

test('missing fifth in sevenths', () => {
  assert.equal(top([48, 52, 58]), 'C7');
  assert.equal(top([48, 51, 58]), 'Cm7');
});

test('chord parse round trip for every type', () => {
  for (const id of Object.keys(TYPES)) {
    for (const root of [0, 3, 6, 10]) {
      const c = { root, type: id, bass: null };
      const txt = chordText(c);
      const back = parseChord(txt);
      assert.ok(back, `parse ${txt}`);
      assert.equal(back.root, root, txt);
      assert.equal(back.type, id, txt);
    }
  }
  assert.deepEqual(parseChord('Am7/G'), { root: 9, type: 'm7', bass: 7 });
  assert.deepEqual(parseChord('bb'), { root: 10, type: 'maj', bass: null });
  assert.deepEqual(parseChord('F#m'), { root: 6, type: 'min', bass: null });
  assert.deepEqual(parseChord('C/C'), { root: 0, type: 'maj', bass: null });
  assert.equal(parseChord('Hxyz'), null);
  assert.equal(parseChord('Cfoo'), null);
});

test('key detection and roman numerals', () => {
  const C = { root: 0, type: 'maj', bass: null };
  const F = { root: 5, type: 'maj', bass: null };
  const G = { root: 7, type: 'maj', bass: null };
  const Am = { root: 9, type: 'min', bass: null };
  const k = detectKey([C, Am, F, G, C].map((chord) => ({ chord, weight: 4 })));
  assert.equal(k.tonic, 0);
  assert.equal(k.mode, 'major');
  assert.equal(keyName(k), 'Đô trưởng');
  assert.deepEqual(roman(G, k), { base: 'V', suffix: '' });
  assert.deepEqual(roman(Am, k), { base: 'vi', suffix: '' });
  assert.ok(inKey(F, k));
  assert.ok(!inKey({ root: 10, type: 'maj', bass: null }, k));
  const km = detectKey([Am, F, C, G, Am].map((chord) => ({ chord, weight: 4 })));
  assert.ok([0, 9].includes(km.tonic));
  const minorKey = detectKey([Am, { root: 2, type: 'min', bass: null }, { root: 4, type: 'dom7', bass: null }, Am].map((chord) => ({ chord, weight: 4 })));
  assert.equal(minorKey.tonic, 9);
  assert.equal(minorKey.mode, 'minor');
});

test('suggestions follow the key', () => {
  const key = { tonic: 0, mode: 'major' };
  const s = suggestNext({ root: 7, type: 'maj', bass: null }, key);
  assert.ok(s.length >= 3);
  assert.equal(chordText(s[0].chord), 'C');
  assert.ok(s.every((x) => x.reason && x.roman));
  assert.deepEqual(suggestNext(null, null), []);
});

test('voicing is sane', () => {
  const v = voiceChord({ root: 0, type: 'maj7', bass: 4 });
  assert.equal(v[0] % 12, 4);
  assert.ok(v.slice(1).every((n) => n >= 50 && n <= 79));
  assert.equal(new Set(v.slice(1).map((n) => n % 12)).size, 4);
});

test('transpose', () => {
  assert.equal(chordText({ root: 9, type: 'min', bass: 7 }, { transpose: 3 }), 'Cm/B♭');
  assert.deepEqual(transposeChord({ root: 11, type: 'maj', bass: null }, 1), { root: 0, type: 'maj', bass: null });
});

test('exports', () => {
  const project = {
    title: 'Thử', bpm: 100, beats: 4, bars: 4, transpose: 0, keyOverride: null,
    events: [
      { id: 'a', beat: 0, chord: { root: 9, type: 'min', bass: null } },
      { id: 'b', beat: 4, chord: { root: 5, type: 'maj', bass: null } },
      { id: 'c', beat: 8, chord: { root: 0, type: 'maj', bass: null } },
      { id: 'd', beat: 12, chord: { root: 7, type: 'maj', bass: null } },
    ],
    rows: { 0: { label: 'Đoạn 1', lyrics: 'xin chào' } },
  };
  const midi = buildMidi(project);
  assert.equal(String.fromCharCode(...midi.slice(0, 4)), 'MThd');
  assert.ok(midi.length > 60);
  const txt = projectToText(project, { perRow: 4, key: { tonic: 0, mode: 'major' } });
  assert.ok(txt.includes('| Am | F | C | G |'), txt);
  assert.ok(txt.includes('xin chào'));
});
