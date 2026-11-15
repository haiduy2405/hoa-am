// Luôn hỏi lại máy chủ (no-cache) nên bản mới đẩy lên là dùng ngay, không bị kẹt bộ nhớ đệm 10 phút của GitHub Pages.
// Mất mạng thì dùng bản đã lưu.
const CACHE = 'notroi-app';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.url, copy)); }
      return res;
    }).catch(() => caches.match(req.url).then((r) => r || caches.match('./index.html')))
  );
});
