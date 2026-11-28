// 星语恋庭 · PWA 极速离线与边缘加速 Service Worker
const CACHE_VERSION = 'star-whisper-ada6674945';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;
const PRECACHE_URLS = [
  './dist/app.bundle.css?v=ad9516d86d',
  './dist/app.bundle.js?v=049d16e8ce',
  './assets/deepseek-whale.svg'
];
const MAX_STATIC_CACHE_ENTRIES = 80;
const MAX_ASSETS_CACHE_ENTRIES = 160;

async function putAndTrimCache(cacheName, req, resClone, maxEntries, { dedupePathname = false } = {}) {
  const cache = await caches.open(cacheName);
  if (dedupePathname) {
    try {
      const targetUrl = new URL(req.url || req);
      const existingKeys = await cache.keys();
      for (const oldReq of existingKeys) {
        try {
          const oldUrl = new URL(oldReq.url);
          if (oldUrl.origin === targetUrl.origin && oldUrl.pathname === targetUrl.pathname && oldUrl.search !== targetUrl.search) {
            await cache.delete(oldReq);
          }
        } catch {}
      }
    } catch {}
  }
  await cache.put(req, resClone);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map((u) =>
          fetch(u, { cache: 'no-cache' })
            .then((res) => {
              if (res && res.status === 200) {
                return cache.put(u, res);
              }
            })
            .catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== STATIC_CACHE && key !== ASSETS_CACHE) {
              return caches.delete(key);
            }
          })
        );
      }),
      (async () => {
        try {
          if (self.registration && self.registration.navigationPreload) {
            await self.registration.navigationPreload.enable();
          }
        } catch {}
      })()
    ]).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isUploadAsset = /^\/api\/uploads\/(avatars|wallpapers)\//.test(url.pathname);

  // 1. 动态接口（除不可变上传静态图）、主页面 HTML 导航与 APK 大文件下载直连绕过
  if (
    req.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/sw.js') ||
    (url.pathname.startsWith('/api/') && !isUploadAsset) ||
    url.pathname.startsWith('/downloads/') ||
    url.pathname.includes('/_star_api_fallback')
  ) {
    return;
  }

  // 2. 静态图标、音频、展示截图与不可变用户上传头像/壁纸（Cache-First 策略：极速秒开并节省移动流量）
  if (url.pathname.startsWith('/assets/') || isUploadAsset) {
    event.respondWith(
      caches.open(ASSETS_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
              event.waitUntil(
                putAndTrimCache(ASSETS_CACHE, req, networkRes.clone(), MAX_ASSETS_CACHE_ENTRIES).catch(() => {})
              );
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

    // 带版本指纹：Cache-First 零等待本地秒开，写入时自动清理旧指纹条目
    if (hasVersionFingerprint) {
      event.respondWith(
        caches.open(STATIC_CACHE).then((cache) => {
          return cache.match(req).then((cached) => {
            if (cached) return cached;
            return fetch(req).then((networkRes) => {
              if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
                event.waitUntil(
                  putAndTrimCache(STATIC_CACHE, req, networkRes.clone(), MAX_STATIC_CACHE_ENTRIES, {
                    dedupePathname: true
                  }).catch(() => {})
                );
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
                event.waitUntil(
                  putAndTrimCache(STATIC_CACHE, req, networkRes.clone(), MAX_STATIC_CACHE_ENTRIES).catch(() => {})
                );
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
