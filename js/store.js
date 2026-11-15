// Lưu trên trình duyệt: cài đặt và các bài MIDI đã mở (tự lưu mỗi khi sửa).
import { deserializeSong, serializeSong } from './songmidi.js';

const K = { set: 'hoaam.settings.v1', lib: 'hoaam.songs.v1', old: 'hoaam.projects.v1', cur: 'hoaam.song.cur.v1' };

export const DEFAULTS = {
  channels: [1, 2, 3], // kênh đàn gửi nốt khi bạn chơi (tay phải, tay trái)
  octave: 'yamaha', // yamaha: phím giữa là C3 | intl: phím giữa là C4
  solfege: false,
};

const read = (k, fallback) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch (e) {
    return false; // hết chỗ hoặc bị chặn: app vẫn chạy, người gọi quyết định báo gì
  }
};

export const loadSettings = () => ({ ...DEFAULTS, ...read(K.set, {}) });
export const saveSettings = (s) => write(K.set, s);

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Bản cũ lưu bài trong "dự án" có kèm hợp âm. Lấy phần MIDI sang kho mới, một lần.
function migrate() {
  if (read(K.lib, null)) return;
  const old = read(K.old, {});
  const lib = {};
  for (const p of Object.values(old)) {
    if (!p || !p.midi) continue;
    lib[p.id] = { id: p.id, title: p.title || '', created: p.created || Date.now(), updated: p.updated || Date.now(), song: p.midi.parts ? p.midi : serializeSong(p.midi) };
  }
  write(K.lib, lib);
  const cur = read(K.cur, null);
  if (cur && !lib[cur]) write(K.cur, null);
}

const lib = () => { migrate(); return read(K.lib, {}); };

// Danh sách ngắn cho giao diện, mới sửa nhất đứng đầu.
export function listSongs() {
  return Object.values(lib()).map((e) => {
    const notes = (e.song.parts || []).reduce((a, p) => a + (p.notes ? p.notes.length : 0), 0);
    return { id: e.id, title: e.title, updated: e.updated, parts: (e.song.parts || []).length, notes, bpm: e.song.tempos && e.song.tempos[0] ? Math.round(e.song.tempos[0][1] ?? e.song.tempos[0].bpm) : 0 };
  }).sort((a, b) => b.updated - a.updated);
}

export function saveSong(id, song) {
  const all = lib();
  const prev = all[id];
  all[id] = { id, title: song.title || '', created: prev ? prev.created : Date.now(), updated: Date.now(), song: serializeSong(song) };
  write(K.cur, id);
  return write(K.lib, all);
}

export function loadSong(id) {
  const e = lib()[id];
  if (!e) return null;
  try {
    const song = deserializeSong(e.song);
    song.title = e.title || song.title || '';
    return song;
  } catch (err) {
    return null;
  }
}

export function deleteSong(id) {
  const all = lib();
  delete all[id];
  write(K.lib, all);
  if (read(K.cur, null) === id) write(K.cur, null);
}

export const currentId = () => read(K.cur, null);
export const setCurrent = (id) => write(K.cur, id);
