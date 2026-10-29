self.addEventListener('message', function(event) { if(event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting(); });
/* 上海初高古诗文背诵 —— Service Worker
   只服务模块化 / http(s) 版本；单文件版用 file:// 打开时不会注册。
   策略：
   - 页面导航：网络优先，断网回退到缓存的 index.html；
   - 静态资源：缓存优先，同时在后台更新缓存（stale-while-revalidate）。
   发布新版本时把 CACHE 里的版本号 +1，旧缓存会在 activate 时清掉。 */
'use strict';

var CACHE = 'poetry-recite-features-1.5.1-backup-retry-fix';
var ASSETS = [
  './',
  './index.html',
  './assets/styles.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './manifest.webmanifest',
  './data/metadata.js',
  './data/junior.js',
  './data/senior.js',
  './data/database.js',
  './js/utils.js',
  './js/brand.js',
  './js/storage.js',
  './js/study.js',
  './js/quiz.js',
  './js/worksheet.js',
  './js/app.js',
  './js/pwa.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return undefined;
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf('poetry-recite-') === 0 && key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      }).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        }).catch(function () {
          return cached;
        });
        return cached || network;
      });
    })
  );
});
