// 星语恋庭 · PWA 极速离线与边缘加速 Service Worker
const CACHE_VERSION = 'star-whisper-v20261120-instant-boot-v5';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;
const MAX_STATIC_CACHE_ENTRIES = 80;

async function putAndTrimStaticCache(req, resClone) {
  const cache = await caches.open(STATIC_CACHE);
  await cache.put(req, resClone);
  const keys = await cache.keys();
  if (keys.length > MAX_STATIC_CACHE_ENTRIES) {
    const excess = keys.length - MAX_STATIC_CACHE_ENTRIES;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== ASSETS_CACHE) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. 动态接口、主页面 HTML 导航与 APK 大文件下载直连绕过（避免 SW 唤醒等待阻塞首屏推门渲染）
  if (
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/sw.js') ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/downloads/') ||
    url.pathname.includes('/_star_api_fallback')
  ) {
    return;
  }

  // 2. 立绘图片、静态音频与展示截图（Cache-First 策略：极速秒开并节省移动流量）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          });
        });
      })
    );
    return;
  }
});
