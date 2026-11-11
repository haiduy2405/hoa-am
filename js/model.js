// Mô hình bản nhạc: hàm thuần để dùng cho giao diện, xuất file và test.

export function sortedEvents(P) {
  return [...P.events].sort((a, b) => a.beat - b.beat);
}

export function totalBars(P, perRow = 4) {
  const ev = P.events;
  const last = ev.length ? Math.max(...ev.map((e) => e.beat)) : 0;
  const need = Math.ceil((last + 0.001) / P.beats);
  const bars = Math.max(P.bars || perRow * 2, need);
  return Math.ceil(bars / perRow) * perRow;
}

// Các hợp âm nằm trong ô nhịp i. `carry` là hợp âm còn ngân từ ô trước.
export function barChords(P, i) {
  const ev = sortedEvents(P);
  const s = i * P.beats;
  const e = s + P.beats;
  const inside = ev.filter((x) => x.beat >= s && x.beat < e);
  const chords = inside.map((x, k) => {
    const next = inside[k + 1];
    return { ev: x, start: x.beat - s, span: (next ? next.beat : e) - x.beat };
  });
  // Hợp âm chỉ "ngân" sang ô này khi sau đó còn hợp âm khác; hợp âm cuối bài dừng ở hết ô của nó.
  let carry = null;
  const hasLater = ev.some((x) => x.beat >= e);
  if ((!inside.length && hasLater) || (inside.length && inside[0].beat > s)) {
    const before = ev.filter((x) => x.beat < s);
    carry = before.length ? { ev: before[before.length - 1], span: inside.length ? inside[0].beat - s : P.beats } : null;
  }
  return { chords, carry };
}

export function chordAtBeat(P, beat) {
  const ev = sortedEvents(P);
  let found = null;
  for (const e of ev) if (e.beat <= beat + 1e-6) found = e;
  return found;
}

export function weightedChords(P) {
  const ev = sortedEvents(P);
  const end = Math.ceil((ev.length ? ev[ev.length - 1].beat + 1 : 0) / P.beats) * P.beats;
  return ev.map((e, i) => ({ chord: e.chord, weight: Math.max(0.25, (ev[i + 1] ? ev[i + 1].beat : end) - e.beat) }));
}

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id' + Math.random().toString(36).slice(2) + Date.now().toString(36));

export function newProject() {
  const now = Date.now();
  return { id: uid(), title: '', bpm: 90, beats: 4, bars: 8, keyOverride: null, transpose: 0, events: [], rows: {}, created: now, updated: now };
}
