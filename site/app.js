(() => {
  const GAMES = window.GAMES ?? [];
  const META = window.GAMES_META ?? {};

  const $ = (id) => document.getElementById(id);
  const els = {
    grid: $('grid'), count: $('count'), serial: $('serial'), empty: $('empty'), search: $('search'),
    platform: $('platform'), genre: $('genre'), decade: $('decade'), sort: $('sort'),
    reset: $('reset'), theme: $('theme'), dialog: $('dialog'), generated: $('generated'),
  };

  const isRecs = META.page === 'consigliati';
  const defaultSort = isRecs ? 'priority' : 'title';

  const norm = (s) => String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();

  // ---- filtri ----
  const fillSelect = (el, values) => {
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      el.append(opt);
    }
  };
  fillSelect(els.platform, META.platforms ?? [...new Set(GAMES.map((g) => g.platform).filter(Boolean))].sort());
  fillSelect(els.genre, META.genres ?? [...new Set(GAMES.flatMap((g) => g.genres ?? []))].sort());
  fillSelect(els.decade, [...new Set(GAMES.map((g) => g.year).filter(Boolean).map((y) => `${Math.floor(y / 10) * 10}s`))]
    .sort((a, b) => parseInt(b) - parseInt(a)));

  // la pagina dei consigli porta con sé un filtro in più: il motivo del suggerimento
  let kindSelect = null;
  if (META.kinds?.length) {
    kindSelect = document.createElement('select');
    kindSelect.className = 'select';
    kindSelect.setAttribute('aria-label', 'Motivo del consiglio');
    kindSelect.innerHTML = '<option value="">Tutti i motivi</option>';
    for (const k of META.kinds) {
      const opt = document.createElement('option');
      opt.value = k.value; opt.textContent = k.label;
      kindSelect.append(opt);
    }
    els.platform.before(kindSelect);
  }

  const SORTS = {
    'title': (a, b) => a.title.localeCompare(b.title, 'it'),
    'title-desc': (a, b) => b.title.localeCompare(a.title, 'it'),
    'year-desc': (a, b) => (b.year ?? -1) - (a.year ?? -1) || a.title.localeCompare(b.title, 'it'),
    'year': (a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title, 'it'),
    'rating': (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title, 'it'),
    'priority': (a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.title.localeCompare(b.title, 'it'),
  };

  function filtered() {
    const q = norm(els.search.value);
    const platform = els.platform.value;
    const genre = els.genre.value;
    const decade = els.decade.value ? parseInt(els.decade.value) : null;

    return GAMES.filter((g) => {
      if (q && !norm(`${g.title} ${g.titleRaw ?? ''} ${g.edition ?? ''} ${g.developer ?? ''} ${g.publisher ?? ''}`).includes(q)) return false;
      if (platform && g.platform !== platform) return false;
      if (genre && !(g.genres ?? []).includes(genre)) return false;
      if (decade != null && (g.year == null || Math.floor(g.year / 10) * 10 !== decade)) return false;
      if (kindSelect?.value && g.kind !== kindSelect.value) return false;
      return true;
    }).sort(SORTS[els.sort.value] ?? SORTS.title);
  }

  // ---- griglia ----
  function placeholder(game) {
    const div = document.createElement('div');
    div.className = 'placeholder';
    div.textContent = game.status === 'pending' ? 'in attesa di metadati' : 'copertina assente';
    return div;
  }

  function card(game) {
    const el = document.createElement('button');
    el.className = 'card';
    el.type = 'button';
    el.dataset.id = game.id;

    const art = document.createElement('div');
    art.className = 'card-art';
    if (game.cover) {
      const img = document.createElement('img');
      img.src = game.cover;
      img.alt = `Copertina di ${game.title}`;
      img.loading = 'lazy';
      img.decoding = 'async';
      img.addEventListener('error', () => img.replaceWith(placeholder(game)), { once: true });
      art.append(img);
    } else {
      art.append(placeholder(game));
    }
    if (game.rating) {
      const badge = document.createElement('span');
      badge.className = game.rating >= 90 ? 'badge high' : 'badge';
      badge.textContent = game.rating;
      art.append(badge);
    }

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = game.title;
    title.title = game.title;

    if (game.kind) {
      const kind = document.createElement('span');
      kind.className = `kind kind-${game.kind}`;
      kind.textContent = { saga: 'saga', edizione: 'edizione', genere: 'affine' }[game.kind] ?? game.kind;
      art.append(kind);
    }

    const sub = document.createElement('div');
    sub.className = 'card-sub';
    sub.textContent = [game.platform, game.year, game.copies ? `×${game.copies}` : null]
      .filter(Boolean).join(' · ');

    el.append(art, title, sub);
    return el;
  }

  function render() {
    const list = filtered();
    els.grid.replaceChildren(...list.map(card));
    els.empty.hidden = list.length > 0;
    const noun = isRecs ? 'consigli' : 'titoli';
    const cases = META.cases && META.cases !== GAMES.length ? ` · ${META.cases} custodie` : '';
    els.count.textContent = list.length === GAMES.length
      ? `${GAMES.length} ${noun}${cases}`
      : `${list.length} di ${GAMES.length} ${noun}`;
  }

  // ---- scheda di dettaglio ----
  function openDialog(game) {
    if (!game) return;

    const cover = $('d-cover');
    cover.hidden = !game.cover;
    if (game.cover) {
      cover.src = game.cover;
      cover.alt = `Copertina di ${game.title}`;
      cover.onerror = () => { cover.hidden = true; };
    }

    $('d-title').textContent = game.title || game.titleRaw || 'Senza titolo';
    $('d-meta').textContent = [game.platform, game.edition, game.year,
      game.rating ? `voto ${game.rating}/100` : null,
      game.copies ? `${game.copies} copie` : null].filter(Boolean).join(' · ') || '—';

    const summary = $('d-summary');
    summary.textContent = game.summary ?? '';
    summary.hidden = !game.summary;

    const why = $('d-why');
    if (why) {
      why.textContent = game.because ?? '';
      why.hidden = !game.because;
    }

    const rows = [
      ['Nasce da', game.source],
      ['Edizione', game.edition],
      ['Generi', (game.genres ?? []).join(', ')],
      ['Sviluppatore', game.developer],
      ['Publisher', game.publisher],
      ['Letto dalla foto', game.titleRaw],
      ['Foto', game.photo],
      ['Note', game.notes],
    ].filter(([, v]) => v);
    const dl = $('d-details');
    dl.replaceChildren();
    for (const [k, v] of rows) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      dl.append(dt, dd);
    }

    const link = $('d-link');
    link.hidden = !game.igdbUrl;
    if (game.igdbUrl) link.href = game.igdbUrl;

    els.dialog.hidden = false;
    document.body.style.overflow = 'hidden';
    history.replaceState(null, '', `#g=${game.id}`);
  }

  function closeDialog() {
    els.dialog.hidden = true;
    document.body.style.overflow = '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }

  // ---- eventi ----
  els.grid.addEventListener('click', (e) => {
    const el = e.target.closest('.card');
    if (el) openDialog(GAMES.find((g) => String(g.id) === el.dataset.id));
  });
  els.dialog.addEventListener('click', (e) => { if (e.target.hasAttribute('data-close')) closeDialog(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !els.dialog.hidden) closeDialog();
    if (e.key === '/' && document.activeElement !== els.search) { e.preventDefault(); els.search.focus(); }
  });
  for (const el of [els.search, els.platform, els.genre, els.decade, els.sort, kindSelect]) {
    el?.addEventListener('input', render);
  }
  els.reset.addEventListener('click', () => {
    els.search.value = '';
    for (const el of [els.platform, els.genre, els.decade, kindSelect]) { if (el) el.value = ''; }
    els.sort.value = defaultSort;
    render();
  });

  // ---- tema: chiaro di giorno, scuro di sera, con preferenza ricordata ----
  const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  let theme = null;
  try { theme = localStorage.getItem('ga-theme'); } catch { /* storage non disponibile */ }
  const applyTheme = (t) => {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  };
  applyTheme(theme);
  els.theme.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme || (prefersDark() ? 'dark' : 'light');
    theme = current === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try { localStorage.setItem('ga-theme', theme); } catch { /* ignora */ }
  });

  // ---- avvio ----
  els.sort.value = defaultSort;

  const years = GAMES.map((g) => g.year).filter(Boolean);
  if (years.length) els.serial.textContent = `${Math.min(...years)}—${Math.max(...years)}`;
  if (META.generated) {
    els.generated.textContent = `Aggiornato ${new Date(META.generated).toLocaleDateString('it-IT')}`;
  }
  if (!GAMES.length) {
    els.empty.textContent = 'Archivio vuoto: importa le foto e lancia gli script in scripts/.';
    els.empty.hidden = false;
  }
  render();

  const params = new URLSearchParams(location.search);
  if (params.get('theme')) applyTheme(params.get('theme'));

  const fromHash = location.hash.match(/^#g=(\d+)$/);
  if (fromHash) openDialog(GAMES.find((g) => String(g.id) === fromHash[1]));
})();
