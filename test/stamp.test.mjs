import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from '../tools/stamp.mjs';

test('index.html đã gắn đúng phiên bản (chạy npm run stamp nếu lỗi)', () => {
  const { html } = build();
  assert.equal(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), html);
});
