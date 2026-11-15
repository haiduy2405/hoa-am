// Tiến trình học: sao từng bài, tổng sao, chuỗi ngày luyện tập. Lưu trong localStorage, không cần tài khoản.
const KEY = 'notroi.progress.v1';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
const write = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* bỏ qua */ } };
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return day(d); };

export const starsOf = (title) => ((read().songs || {})[title] || {}).stars || 0;
export const totalStars = () => Object.values(read().songs || {}).reduce((a, s) => a + (s.stars || 0), 0);
export const streak = () => { const s = read().streak; return s && (s.last === day() || s.last === yesterday()) ? s.count : 0; };

// Ghi một lượt chơi. Trả về { stars, best, firstStars, streak } để màn hình kết quả hiển thị.
export function record(title, stars, score = 0) {
  const d = read();
  d.songs = d.songs || {};
  const prev = d.songs[title] || { stars: 0, score: 0, plays: 0 };
  const out = { stars: Math.max(prev.stars, stars), best: stars > prev.stars, gained: Math.max(0, stars - prev.stars) };
  d.songs[title] = { stars: out.stars, score: Math.max(prev.score, score), plays: prev.plays + 1 };
  const s = d.streak || { last: '', count: 0 };
  if (s.last !== day()) { s.count = s.last === yesterday() ? s.count + 1 : 1; s.last = day(); }
  d.streak = s;
  write(d);
  out.streak = s.count;
  return out;
}

// Độ khó ước lượng từ mật độ nốt (nốt mỗi giây) của bài.
export function difficulty(entry) {
  const dens = entry.notes / Math.max(1, entry.dur);
  return dens < 3.2 ? 'easy' : dens < 6 ? 'mid' : 'hard';
}
export const DIFF_TEXT = { easy: 'Dễ', mid: 'Vừa', hard: 'Khó' };
