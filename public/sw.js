// 星语恋庭 · PWA 极速离线与边缘加速 Service Worker
const CACHE_VERSION = 'star-whisper-v20261125-v244-r1';
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
  if (url.origin !== self.location.origin) return;

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

  // 2. 静态图标、音频与展示截图（Cache-First 策略：极速秒开并节省移动流量）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
              cache.put(req, networkRes.clone());
            }
            return networkRes;
          });
        });
      })
    );
    return;
  }

  // 3. JS 脚本与 CSS 样式表缓存策略
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    const hasVersionFingerprint = Boolean(url.searchParams.get('v'));

    // 带版本指纹：Cache-First 零等待本地秒开
    if (hasVersionFingerprint) {
      event.respondWith(
        caches.open(STATIC_CACHE).then((cache) => {
          return cache.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((networkRes) => {
              if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                event.waitUntil(putAndTrimStaticCache(req, networkRes.clone()).catch(() => {}));
              }
              return networkRes;
            });
          });
        })
      );
      return;
    }

    // 无版本指纹：Stale-While-Revalidate 优先返回缓存并后台静默刷新
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          const networkFetch = fetch(req)
            .then((networkRes) => {
              if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                event.waitUntil(putAndTrimStaticCache(req, networkRes.clone()).catch(() => {}));
              }
              return networkRes;
            })
            .catch(() => cached);

          if (cached) {
            event.waitUntil(networkFetch.catch(() => {}));
            return cached;
          }
          return networkFetch;
        });
      })
    );
  }
});
