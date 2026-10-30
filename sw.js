const CACHE_NAME = 'souroku-v9';
const APP_FILES = [
  './',
  './index.html',
  './styles/base.css',
  './styles/layout.css',
  './styles/screens/login.css',
  './styles/screens/entry.css',
  './styles/screens/records.css',
  './styles/screens/analytics.css',
  './styles/screens/admin.css',
  './main.js',
  './shared/data.js',
  './shared/supabase-config.js',
  './shared/supabase.js',
  './shared/layout.js',
  './shared/templates.js',
  './shared/templates/shell.html',
  './screens/login.js',
  './screens/entry.js',
  './screens/records.js',
  './screens/analytics.js',
  './screens/admin.js',
  './screens/templates/login.html',
  './screens/templates/entry.html',
  './screens/templates/records.html',
  './screens/templates/analytics.html',
  './screens/templates/admin.html',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === self.location.origin) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});