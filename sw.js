// 원윤메디팜 알림 서비스 워커 — 푸시 알림을 보여 주고, 누르면 사이트의 해당 화면을 열어요.
// 화면·데이터 저장(캐시)은 하지 않아요. 사이트는 항상 최신 파일을 그대로 불러와요.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: '원윤메디팜', body: e.data ? e.data.text() : '' }; }
  const base = self.registration.scope;
  e.waitUntil(self.registration.showNotification(d.title || '원윤메디팜', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: base + 'assets/icon-192.png',
    badge: base + 'assets/badge-96.png',
    timestamp: d.ts || Date.now(),
    lang: 'ko',
    data: { url: base + (d.url || '') },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => c.url.startsWith(self.registration.scope));
    if (w) {
      try { await w.focus(); } catch (_) { /* 포커스가 안 되는 브라우저 */ }
      w.postMessage({ type: 'nav', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
