/**
 * Service worker: il sito deve aprirsi anche con la rete lenta o assente (una fiera, per esempio).
 *
 * - pagine, script, stile e dati: prima la rete, così gli aggiornamenti si vedono subito;
 *   se non risponde entro 3 secondi, o non c'è, si usa la copia salvata
 * - copertine: prima la copia salvata (per sostituirne una, cambiare il numero di COVERS)
 */
const SHELL = 'ga-shell-v1';
const COVERS = 'ga-covers-v1';
const TIMEOUT_MS = 3000;
// dopo un'attesa a vuoto, per questo tempo il resto della pagina arriva subito dalla copia salvata
const SLOW_MS = 10000;
let slowUntil = 0;
const FILES = [
  './', 'index.html', 'consigliati.html', 'styles.css', 'search.js', 'app.js', 'offline.js', 'favicon.svg',
  'data/games.js', 'data/games.json', 'data/recommendations.js', 'data/recommendations.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('ga-') && name !== SHELL && name !== COVERS) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(url.pathname.includes('/covers/') ? cacheFirst(request) : networkFirst(event, url));
});

async function cacheFirst(request) {
  const cache = await caches.open(COVERS);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(event, url) {
  const cache = await caches.open(SHELL);
  // ?q= e ?theme= non cambiano il file: la copia salvata vale per tutti
  const saved = await cache.match(event.request, { ignoreSearch: true });
  const network = fetch(event.request).then(async (response) => {
    if (response.ok) await cache.put(url.origin + url.pathname, response.clone());
    return response;
  });
  if (!saved) return network;

  event.waitUntil(network.catch(() => {}));   // anche se arriva tardi, aggiorna la copia
  if (event.request.mode === 'navigate') slowUntil = 0;   // ogni pagina nuova riprova la rete
  if (Date.now() < slowUntil) return saved;

  let timer;
  const tooSlow = new Promise((resolve) => {
    timer = setTimeout(() => {
      slowUntil = Date.now() + SLOW_MS;
      resolve(saved);
    }, TIMEOUT_MS);
  });
  const fresh = network
    .then((response) => (response.ok ? response : saved), () => saved)
    .finally(() => clearTimeout(timer));
  return Promise.race([fresh, tooSlow]);
}
