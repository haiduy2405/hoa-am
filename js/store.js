import { newProject } from './model.js';

const K = { set: 'hoaam.settings.v1', lib: 'hoaam.projects.v1', cur: 'hoaam.current.v1' };

export const DEFAULTS = {
  solfege: false,
  flatPref: 'auto', // auto | sharp | flat
  level: 0, // 0 cơ bản, 1 đầy đủ
  channels: [1, 2, 3],
  ghost: true,
  pedal: false,
  roman: true,
  quant: '1',
  countIn: true,
  metro: true,
  loop: false,
  output: 'browser', // browser | midi
  volume: 0.7,
  keys: 61,
  octave: 'yamaha', // yamaha: phím giữa là C3 | intl: phím giữa là C4
  qwerty: true,
  perRow: 4,
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
  } catch (e) {
    /* hết chỗ hoặc bị chặn: bỏ qua, app vẫn chạy */
  }
};

export const loadSettings = () => ({ ...DEFAULTS, ...read(K.set, {}) });
export const saveSettings = (s) => write(K.set, s);

export function normalizeProject(p) {
  const base = newProject();
  const out = { ...base, ...(p || {}) };
  out.events = Array.isArray(out.events) ? out.events.filter((e) => e && e.chord && Number.isFinite(e.beat)) : [];
  out.rows = out.rows && typeof out.rows === 'object' ? out.rows : {};
  out.bpm = Math.min(260, Math.max(30, +out.bpm || 90));
  out.beats = Math.min(6, Math.max(2, +out.beats || 4));
  out.transpose = Math.max(-11, Math.min(11, +out.transpose || 0));
  return out;
}

export const loadLibrary = () => read(K.lib, {});

export function saveProject(p) {
  const lib = loadLibrary();
  lib[p.id] = p;
  write(K.lib, lib);
  write(K.cur, p.id);
}

export function deleteProject(id) {
  const lib = loadLibrary();
  delete lib[id];
  write(K.lib, lib);
}

export function loadCurrent() {
  const lib = loadLibrary();
  const id = read(K.cur, null);
  return id && lib[id] ? normalizeProject(lib[id]) : null;
}

export const setCurrent = (id) => write(K.cur, id);
