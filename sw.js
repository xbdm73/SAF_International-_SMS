/* SAF International — service worker du CMS (hors ligne iPad), oct. 2026
   - Pages HTML : réseau d'abord (version à jour dès qu'il y a du réseau),
     copie en cache en secours, délai max 5 s.
   - Bibliothèques CDN (Supabase, pdf.js, polices) : cache d'abord, mise à jour
     en arrière-plan.
   - Jamais de cache pour l'API Supabase (données, authentification, fichiers). */
const VERSION = 'saf-cms-2026-11-10a';
// Page du CMS telle que l'ouvre la tuile du portail (URL « jolie » Netlify, sans .html)
const PAGE = './saf_international_compliance_monitoring_system';
const CORE = [
  PAGE,
  './manifest.webmanifest',
  './cms-icon-180.png', './cms-icon-192.png', './cms-icon-512.png'
];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(CORE.map(async u => {
      try { const r = await fetch(new Request(u, { cache: 'reload' })); if (r.ok) await c.put(u, await storable(r)); } catch (_) {}
    }));
    await Promise.all(CDN.map(async u => {
      try { const r = await fetch(u, { mode: 'no-cors' }); await c.put(u, r); } catch (_) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('saf-cms-') && k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function storable(r) {
  if (!r || !r.redirected) return r;
  const b = await r.blob();
  return new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers });
}

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

async function networkFirst(req) {
  const c = await caches.open(VERSION);
  const net = fetch(req).then(async r => { if (r && r.ok) { const s = await storable(r.clone()); await c.put(req, s); return r.redirected ? s.clone() : r; } return r; });
  try { return await Promise.race([net, timeout(5000)]); }
  catch (_) {
    const hit = await c.match(req, { ignoreSearch: true })
      || await c.match(new URL(req.url).pathname.replace(/\.html?$/i, ''), { ignoreSearch: true })
      || (/compliance_monitoring_system/i.test(req.url) ? await c.match(PAGE) : null);
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }
}

async function staleWhileRevalidate(req) {
  const c = await caches.open(VERSION);
  const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || fetch(req);
}

/* 10.11.2026 — Le service worker est installé par le CMS mais sa portée (/sms/) couvre aussi
   le suivi flotte, le SMS, les Appendices… Il ne prend désormais en charge que ce qui sert au
   CMS hors ligne : la page du CMS, ses icônes et la liste CDN précise ci-dessus. Tout le reste
   passe directement par le navigateur. Avant, il interceptait aussi Leaflet et les polices du
   suivi flotte ; la règle de sécurité du portail lui interdisant ces adresses, il renvoyait une
   réponse vide (504) et la page restait noire jusqu'à un Ctrl+Maj+R. */
const CMS_RE = /compliance_monitoring_system/i;
const OWN_ASSET_RE = /\/(manifest\.webmanifest|cms-icon-\d+\.png)$/i;
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return; // API : jamais en cache
  if (req.mode === 'navigate' || (url.origin === self.location.origin && /\.html?$/.test(url.pathname))) {
    if (CMS_RE.test(url.pathname)) e.respondWith(networkFirst(req));
    return;                                   // autres pages : navigateur seul
  }
  if (url.origin === self.location.origin && OWN_ASSET_RE.test(url.pathname)) { e.respondWith(staleWhileRevalidate(req)); return; }
  if (CDN.includes(req.url)) { e.respondWith(staleWhileRevalidate(req)); return; }
});
