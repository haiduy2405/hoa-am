// Luôn lấy bản mới nhất từ máy chủ: thêm tham số duy nhất để qua mặt cả bộ nhớ đệm CDN của GitHub Pages
// (cache no-cache chỉ qua được bộ nhớ đệm trình duyệt). Mất mạng thì dùng bản đã lưu.
const CACHE = 'notroi-app';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const u = new URL(req.url);
  const key = u.origin + u.pathname; // khóa lưu bản dự phòng không kèm tham số
  u.searchParams.set('_', Date.now());
  e.respondWith(
    fetch(u.toString(), { cache: 'no-store', credentials: 'same-origin' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then((r) => r || caches.match(self.location.origin + '/index.html')))
  );
});
