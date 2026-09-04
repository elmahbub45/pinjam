// Tangani klik lebih dulu agar perilaku kustom tidak ditimpa FCM.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.location.origin).href;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list => {
    for (const client of list) {
      if ('focus' in client) { client.navigate(target); return client.focus(); }
    }
    return clients.openWindow ? clients.openWindow(target) : undefined;
  }));
});

importScripts('./config.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js');

const CACHE = 'pinjam-shell-v1.4.1.1';
const ASSETS = ['./','index.html','styles.css','app.js','api.js','config.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
const cfg = self.PINJAM_CONFIG || {};

if (cfg.FIREBASE && cfg.FIREBASE.projectId) {
  firebase.initializeApp(cfg.FIREBASE);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const n = payload.notification || {};
    const d = payload.data || {};
    const title = n.title || d.title || 'Pinjam';
    self.registration.showNotification(title, {
      body: n.body || d.body || 'Ada pembaruan tagihan.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: d.notificationKey || d.itemId || 'pinjam-reminder',
      data: { url: d.url || './', itemId: d.itemId || '' }
    });
  });
}

self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(fetch(event.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); return res;
  }).catch(() => caches.match(event.request).then(r => r || caches.match('./index.html'))));
});
