import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTitle } from '../js/title.js';

test('clean file names into song titles', () => {
  assert.equal(cleanTitle('01_tinh-ca-que-huong(1).mid'), 'Tinh Ca Que Huong');
  assert.equal(cleanTitle('NGUOI_YEU_CUA_ANH.MID'), 'Nguoi Yeu Cua Anh');
  assert.equal(cleanTitle('Canon in D - Pachelbel [MIDI].mid'), 'Canon in D - Pachelbel');
  assert.equal(cleanTitle('canonInD.mid'), 'Canon In D');
  assert.equal(cleanTitle('Em Của Ngày Hôm Qua (karaoke).midi'), 'Em Của Ngày Hôm Qua');
  assert.equal(cleanTitle('Sơn Tùng - Chạy Ngay Đi_midi.mid'), 'Sơn Tùng - Chạy Ngay Đi');
  assert.equal(cleanTitle('midi.mid'), 'midi');
  assert.equal(cleanTitle('Bài Hát Hay.mid'), 'Bài Hát Hay');
});
