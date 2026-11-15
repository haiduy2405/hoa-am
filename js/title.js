// Biến tên file MIDI thành tên bài dễ đọc: "01_tinh-ca-que-huong(1).mid" -> "Tinh Ca Que Huong".
const JUNK_WORDS = /\b(midi|mid|kar|karaoke|download|free|official|hd|mp3|ver\d*|version)\b/gi;
const JUNK_BRACKET = /[([{][^)\]}]*\b(midi|mid|karaoke|ver|version|official|hd|mp3|free|download|copy|\d+)\b[^)\]}]*[)\]}]/gi;

const cap = (w) => (w ? w.charAt(0).toLocaleUpperCase('vi') + w.slice(1) : w);

export function cleanTitle(fileName) {
  const raw = String(fileName || '').trim();
  let s = raw;
  try { s = decodeURIComponent(s); } catch (e) { /* giữ nguyên */ }
  s = s.replace(/\.(mid|midi|kar)$/i, '');
  s = s.replace(JUNK_BRACKET, ' ');
  s = s.replace(/[_+]+/g, ' ').replace(/\s*\.\s*(?=\S)/g, ' ');
  s = s.replace(/^\s*\d{1,3}\s*[.\-)_ ]+\s*(?=\D)/, ''); // số thứ tự đầu tên: "01 ", "02. "
  if (!/\s/.test(s)) s = s.replace(/([a-zà-ỹ])([A-ZÀ-Ỹ])/g, '$1 $2'); // camelCase
  s = s.replace(/(?<!\s)-+(?!\s)/g, ' '); // gạch nối kiểu slug thành khoảng trắng; " - " giữa tên bài và ca sĩ thì giữ
  s = s.replace(JUNK_WORDS, ' ');
  s = s.replace(/[\s\-–]+$/g, '').replace(/^[\s\-–]+/g, '').replace(/\s{2,}/g, ' ').replace(/\s+-\s+-\s+/g, ' - ');
  if (!s) return raw.replace(/\.(mid|midi|kar)$/i, '') || 'Bài chưa đặt tên';
  const letters = s.replace(/[^\p{L}]/gu, '');
  if (letters && (letters === letters.toLocaleLowerCase('vi') || letters === letters.toLocaleUpperCase('vi'))) {
    s = s.toLocaleLowerCase('vi').split(' ').map(cap).join(' ');
  }
  return cap(s).slice(0, 80);
}
