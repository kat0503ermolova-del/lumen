// Офлайн и быстрый старт.
// Файлы приложения: сразу отдаём сохранённую копию, а свежую версию тихо подгружаем в фоне.
// Шрифты и библиотека облака (с зафиксированной версией): берём из кэша, сеть — только в первый раз.
// При каждом обновлении приложения меняем VERSION — тогда все файлы перекачаются заново.
// Файлы приложения запрашиваем мимо HTTP-кэша браузера (уникальный ?v=…), чтобы не получить
// устаревшую копию. Номер VERSION совпадает с lumen-build в index.html и BUILD в app.js.

const VERSION = 'lumen-v11';
const RUNTIME = 'lumen-runtime-v1';
const ASSETS = [
  './', 'index.html', 'css/styles.css',
  'js/app.js', 'js/parse.js', 'js/recur.js', 'js/sync.js', 'js/data.js', 'js/confetti.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
];
const bust = (u, tag) => {
  const url = new URL(u, self.registration.scope);
  url.searchParams.set('v', tag);
  return url.href;
};
const IMMUTABLE_HOSTS = ['fonts.gstatic.com', 'fonts.googleapis.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(ASSETS.map(async (u) => {
        const res = await fetch(bust(u, VERSION), { cache: 'reload' });
        if (!res.ok) throw new Error(`${u}: ${res.status}`);
        await c.put(new URL(u, self.registration.scope).href, res);
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (IMMUTABLE_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.open(RUNTIME).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return; // Supabase API и прочее — напрямую

  e.respondWith(
    caches.open(VERSION).then(async (c) => {
      const key = url.origin + url.pathname;
      const hit = await c.match(key);
      const fresh = fetch(bust(key, Date.now()), { cache: 'no-store' })
        .then((res) => { if (res.ok) c.put(key, res.clone()); return res; })
        .catch(() => hit);
      if (hit) { e.waitUntil(fresh); return hit; }
      return fresh;
    })
  );
});
