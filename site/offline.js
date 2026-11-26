/**
 * Prepara l'uso senza rete: registra sw.js e salva tutte le copertine (anche quelle dell'altra
 * pagina e quelle non ancora scorse). In testata dice a che punto è: "Pronto offline" vuol dire
 * che il sito si può aprire in modalità aereo.
 */
(() => {
  const status = document.getElementById('offline-status');
  // aperto con doppio clic i file sono già tutti in locale: non c'è niente da salvare
  if (location.protocol === 'file:') return;
  if (!('serviceWorker' in navigator) || !window.isSecureContext || !window.caches) return;

  const PARALLEL = 6;
  const say = (text, state = '') => {
    status.textContent = text;
    status.dataset.state = state;
  };

  async function saveCovers() {
    const lists = await Promise.all(['data/games.json', 'data/recommendations.json']
      .map(async (url) => (await fetch(url)).json()));
    const covers = [...new Set(lists.flatMap((l) => l.games.map((g) => g.cover)).filter(Boolean))];
    const cache = await caches.open('ga-covers-v1');   // stesso nome usato in sw.js

    const queue = [];
    for (const cover of covers) if (!(await cache.match(cover))) queue.push(cover);
    let done = covers.length - queue.length;
    let failed = 0;

    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) {
        const cover = queue.pop();
        try {
          const response = await fetch(cover);
          if (!response.ok) throw new Error(String(response.status));
          await cache.put(cover, response);
          done++;
        } catch {
          failed++;
        }
        say(`Salvo per l’offline ${done}/${covers.length}`);
      }
    }));

    if (failed) say(`Offline: mancano ${failed} copertine, riapri con la rete`);
    else say('Pronto offline ✓', 'ready');
  }

  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(saveCovers)
    .catch(() => say('Offline non disponibile'));
})();
