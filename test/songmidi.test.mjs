import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GM, parseMidi, writeMidi, makeSong, newSong, makeClock, songEnd, extractChords, partFromChords, transposeNotes,
  quantizeNotes, scaleTempo, serializeSong, deserializeSong, kindFor, barBeats, freeChannel,
} from '../js/songmidi.js';
import { chordText } from '../js/engine.js';

// Am F C G, mỗi hợp âm một ô nhịp 4/4: piano rải hợp âm + bass nốt gốc
function demo() {
  const ppq = 480;
  const prog = [[57, [0, 3, 7]], [53, [0, 4, 7]], [48, [0, 4, 7]], [55, [0, 4, 7]]];
  const piano = [], bass = [];
  prog.forEach(([root, iv], bar) => {
    for (let b = 0; b < 8; b++) {
      const n = 60 + ((root + iv[b % 3]) % 12) - (((root + iv[b % 3]) % 12) >= 6 ? 12 : 0) + 12 * 0;
      piano.push({ t: bar * 4 * ppq + b * (ppq / 2), d: ppq / 2, n: 55 + ((root + iv[b % 3] - 55 + 120) % 12), v: 80 });
      void n;
    }
    bass.push({ t: bar * 4 * ppq, d: 4 * ppq, n: root - 24 + 12 * 0 + (root < 48 ? 12 : 0), v: 95 });
  });
  return makeSong({
    ppq, title: 'Thử', tempos: [[0, 100], [4 * ppq * 2, 120]], sigs: [[0, 4, 4]],
    parts: [
      { name: 'Piano', channel: 0, program: 0, vol: 100, notes: piano, ctl: [[0, 0xb0, 64, 127], [1000, 0xb0, 64, 0]] },
      { name: 'Bass', channel: 1, program: 33, notes: bass },
      { name: 'Drums', channel: 9, program: 0, notes: [{ t: 0, d: 120, n: 36, v: 100 }, { t: 480, d: 120, n: 38, v: 100 }] },
    ],
  });
}

test('GM list has 128 names', () => assert.equal(GM.length, 128));

test('write then parse keeps everything that matters', () => {
  const a = demo();
  const bytes = writeMidi(a);
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const b = parseMidi(bytes);
  assert.equal(b.ppq, a.ppq);
  assert.equal(b.title, 'Thử');
  assert.equal(b.parts.length, 3);
  assert.deepEqual(b.tempos.map((t) => Math.round(t.bpm)), [100, 120]);
  assert.equal(b.tempos[1].tick, a.tempos[1].tick);
  const [pa, pb] = [a.parts[0], b.parts[0]];
  assert.equal(pb.notes.length, pa.notes.length);
  assert.deepEqual(pb.notes.map((n) => [n.t, n.d, n.n, n.v]), pa.notes.map((n) => [n.t, n.d, n.n, n.v]));
  assert.equal(pb.vol, 100);
  assert.equal(b.parts[1].program, 33);
  assert.equal(b.parts[2].channel, 9);
  assert.equal(b.parts[2].name, 'Drums');
  assert.deepEqual(pb.ctl, pa.ctl); // pedal sustain được giữ lại
});

test('running status and note-on velocity 0 as note-off', () => {
  // MThd format0, 1 track, ppq 96; track: tempo, prog, note 60 on, (running status) note 64 on, vel0 offs
  const trk = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    0x00, 0xc0, 0x05,
    0x00, 0x90, 60, 100,
    0x00, 64, 100, // running status
    0x60, 60, 0, // running status, vel 0 = off
    0x00, 64, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const f = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, trk.length, ...trk];
  const s = parseMidi(Uint8Array.from(f));
  assert.equal(s.parts.length, 1);
  assert.equal(s.parts[0].program, 5);
  assert.deepEqual(s.parts[0].notes.map((n) => [n.t, n.d, n.n]), [[0, 96, 60], [0, 96, 64]]);
  assert.equal(Math.round(s.tempos[0].bpm), 120);
});

test('rejects non-midi input with a readable message', () => {
  assert.throws(() => parseMidi(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])), /không phải file MIDI/);
  assert.throws(() => parseMidi(new Uint8Array(3)), /không phải file MIDI/);
});

test('tempo map converts ticks and ms both ways', () => {
  const s = demo();
  const c = makeClock(s);
  assert.equal(Math.round(c.tickToMs(480)), 600); // 100 BPM: 1 phách = 600ms
  const t = s.tempos[1].tick;
  const ms = c.tickToMs(t);
  assert.equal(Math.round(c.tickToMs(t + 480) - ms), 500); // 120 BPM
  assert.equal(Math.round(c.msToTick(ms)), t);
  assert.equal(Math.round(c.msToTick(c.tickToMs(5000))), 5000);
});

test('extract chords from bars, skipping drums', () => {
  const s = demo();
  const ids = s.parts.map((p) => p.id);
  const ev = extractChords(s, { partIds: ids, unitBeats: 4 });
  assert.deepEqual(ev.map((e) => chordText(e.chord)), ['Am', 'F', 'C', 'G']);
  assert.deepEqual(ev.map((e) => e.beat), [0, 4, 8, 12]);
  const half = extractChords(s, { partIds: ids, unitBeats: 2 });
  assert.deepEqual(half.map((e) => chordText(e.chord)), ['Am', 'F', 'C', 'G']);
});

test('chords to part and back', () => {
  const s = demo();
  const ev = extractChords(s, { partIds: s.parts.map((p) => p.id), unitBeats: 4 }).map((e, i) => ({ id: 'e' + i, ...e }));
  const part = partFromChords(ev, { ppq: 480, beats: 4 });
  const s2 = makeSong({ ppq: 480, parts: [part] });
  const back = extractChords(s2, { partIds: [part.id], unitBeats: 4 });
  assert.deepEqual(back.map((e) => chordText(e.chord)), ['Am', 'F', 'C', 'G']);
});

test('edit helpers', () => {
  const s = demo();
  const n = [{ t: 100, d: 50, n: 60, v: 80 }];
  transposeNotes(n, 14);
  assert.equal(n[0].n, 74);
  transposeNotes(n, -200);
  assert.equal(n[0].n, 0);
  quantizeNotes(n, 120, { ends: true });
  assert.deepEqual([n[0].t, n[0].d], [120, 120]);
  scaleTempo(s, 50);
  assert.equal(Math.round(s.tempos[0].bpm), 50);
  assert.equal(Math.round(s.tempos[1].bpm), 60);
  assert.ok(songEnd(s) > 0);
  assert.equal(barBeats(s), 4);
  assert.equal(freeChannel(s), 2);
  assert.equal(kindFor(33, 1), 'bass');
  assert.equal(kindFor(0, 9), 'drum');
});

test('compact serialization round trip, JSON.stringify is compact', () => {
  const s = demo();
  const json = JSON.stringify({ midi: s });
  assert.ok(json.includes('"notes":[[0,'));
  const back = deserializeSong(JSON.parse(json).midi);
  assert.equal(back.parts[0].notes.length, s.parts[0].notes.length);
  assert.deepEqual(serializeSong(back), serializeSong(s));
  assert.ok(newSong({ bpm: 90 }).parts[0].notes.length === 0);
});
