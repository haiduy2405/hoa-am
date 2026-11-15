// Gắn số phiên bản vào địa chỉ file trong index.html (css, js) để bản mới luôn tải mới, không dính bộ nhớ đệm CDN.
// Chạy: npm run stamp (mỗi lần tăng phiên bản). npm test sẽ báo lỗi nếu quên.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export function build() {
  const ver = /VERSION = '([^']+)'/.exec(readFileSync(join(root, 'js/version.js'), 'utf8'))[1];
  const mods = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js') && f !== 'app.js').sort();
  const map = Object.fromEntries(mods.map((f) => [`./js/${f}`, `./js/${f}?v=${ver}`]));
  const block = [
    '<!-- stamp:start -->',
    `  <link rel="stylesheet" href="css/fonts.css?v=${ver}">`,
    `  <link rel="stylesheet" href="css/style.css?v=${ver}">`,
    `  <script type="importmap">${JSON.stringify({ imports: map })}</script>`,
    '  <!-- stamp:end -->',
  ].join('\n');
  let html = readFileSync(join(root, 'index.html'), 'utf8');
  html = html.replace(/<!-- stamp:start -->[\s\S]*?<!-- stamp:end -->/, block);
  html = html.replace(/src="js\/app\.js[^"]*"/, `src="js/app.js?v=${ver}"`);
  return { html, ver };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html, ver } = build();
  writeFileSync(join(root, 'index.html'), html);
  console.log('Đã gắn phiên bản', ver);
}
