// Service worker toi thieu - chi de thoa dieu kien "cai dat app" tren dien thoai.
// Khong cache du lieu, luon lay ban moi nhat tu mang de tranh hien du lieu cu.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
