// 星语恋庭 · PWA 极速离线与边缘加速 Service Worker
const CACHE_VERSION = 'star-whisper-v20261120-clean-ds';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;

const PRECACHE_MANIFEST = [
  './',
  './styles.css',
  './clean-ui.css',
  './companion3d.css',
  './mobile-responsive.css',
  './phone-agent.css',
  './standaloneAdapter.js',
  './mobileAdapter.js',
  './plugins/deepseekUsageMonitor.js',
  './companion3d.js',
  './companionVoice.js',
  './phoneAgent.js',
  './assets/deepseek-whale.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_MANIFEST).catch((err) => {
        console.warn('[ServiceWorker] 预缓存部分资源失败，将在访问时动态补齐:', err);
      });
    })
  );
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

  // 1. 动态接口与 APK 大文件下载绝对直连绕过
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/downloads/') ||
    url.pathname.includes('/_star_api_fallback')
  ) {
    return;
  }

  // 2. 主页面 HTML 导航请求：网络优先，弱网/离线平滑降级到本地缓存
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, clone));
          }
          return networkRes;
        })
        .catch(() => {
          return caches.match(req).then((cached) => cached || caches.match('/'));
        })
    );
    return;
  }

  // 3. 立绘图片、静态音频与展示截图（Cache-First 策略：极速秒开并节省移动流量）
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

  // 4. JS 脚本与 CSS 样式表（Stale-While-Revalidate 策略：0ms 极速响应，后台静默保新）
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          const fetchPromise = fetch(req)
            .then((networkRes) => {
              if (networkRes && networkRes.status === 200) {
                cache.put(req, networkRes.clone());
              }
              return networkRes;
            })
            .catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }
});
