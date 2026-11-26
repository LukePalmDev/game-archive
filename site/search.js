/**
 * Ricerca tollerante: serve a rispondere "ce l'ho già?" con il telefono davanti a uno scaffale,
 * quindi un falso "non c'è" è l'errore peggiore.
 *
 * - ignora maiuscole, accenti, apostrofi e punteggiatura ("assassins creed")
 * - numeri arabi e romani si equivalgono ("forza 4", "mafia 2")
 * - capisce le sigle ("gta", "cod4", "tlou") e le parole attaccate ("spiderman")
 * - guarda dentro le raccolte ("bioshock infinite" trova BioShock: The Collection)
 *
 * Nessuna dipendenza: nel browser espone window.GASearch.
 */
(() => {
  const ROMAN = {
    i: 1, ii: 2, iii: 3, iiii: 4, iv: 4, v: 5, vi: 6, vii: 7, viii: 8,
    ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
  };

  const ALIASES = {
    ac: ['assassins creed'], bf: ['battlefield'], botw: ['breath of the wild'], cod: ['call of duty'],
    ff: ['final fantasy'], gow: ['god of war', 'gears of war'], gta: ['grand theft auto'],
    kotor: ['knights of the old republic'], mgs: ['metal gear solid'], mk: ['mario kart'],
    mw: ['modern warfare'], nfs: ['need for speed'], pes: ['pro evolution soccer'],
    rdr: ['red dead redemption'], re: ['resident evil'], tlou: ['last of us'],
    totk: ['tears of the kingdom'], tr: ['tomb raider'],
  };

  // parole che possono seguire il titolo del primo capitolo senza renderlo un altro gioco
  const EDITION_WORDS = new Set(['the', 'edition', 'definitive', 'ultimate', 'remastered', 'legendary', 'anniversary', 'hd']);

  const norm = (s) => String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const split = (s) => norm(s).split(' ').filter(Boolean);
  const toNumber = (w) => (Object.hasOwn(ROMAN, w) ? String(ROMAN[w]) : w);
  const isNumber = (w) => /^\d+$/.test(w);

  const entry = (text) => ({ words: split(text).map(toNumber) });

  /** Le letture possibili della query: così com'è, più quelle con le sigle sciolte. */
  function variants(query) {
    const tokens = split(query)
      // "gta5", "cod4": sigla attaccata al numero
      .flatMap((t) => {
        const m = t.match(/^([a-z]+)(\d+)$/);
        return m && Object.hasOwn(ALIASES, m[1]) ? [m[1], m[2]] : [t];
      });
    let out = [[]];
    tokens.forEach((token, i) => {
      const typed = { raw: token, last: i === tokens.length - 1 };
      const options = [[typed]];
      if (Object.hasOwn(ALIASES, token)) {
        for (const full of ALIASES[token]) options.push(full.split(' ').map((raw) => ({ raw, last: false })));
      }
      out = out.flatMap((head) => options.map((tail) => [...head, ...tail])).slice(0, 12);
    });
    return out;
  }

  function wordMatches({ raw, last }, word, loose) {
    if (isNumber(raw)) return word === raw;                    // "forza 4" non è "Forza 2005"
    if (Object.hasOwn(ROMAN, raw)) {
      // l'ultima parola può essere ancora incompleta: "v" sta per 5 ma anche per "valhalla"
      return word === String(ROMAN[raw]) || (last && word.startsWith(raw));
    }
    return word.startsWith(raw) || (loose && raw.length >= 4 && word.includes(raw));
  }

  // loose: nei titoli vale anche il pezzo di parola ("shock") e le parole attaccate; nei nomi
  // delle aziende no, altrimenti "alan" trova tutto ciò che ha sviluppato Avalanche
  function entryMatches(tokens, { words }, loose = true) {
    if (tokens.every((t) => words.some((w) => wordMatches(t, w, loose)))) return true;
    if (!loose) return false;

    // primo capitolo: "mass effect 1" è il titolo senza numero
    const tail = tokens.at(-1);
    if (tail?.raw === '1' && tokens.length > 1 && !words.some(isNumber)) {
      const head = tokens.slice(0, -1);
      const used = words.slice(0, head.length);
      if (used.length === head.length && head.every((t, i) => used[i] === toNumber(t.raw))
        && words.slice(head.length).every((w) => EDITION_WORDS.has(w))) return true;
    }

    // parole attaccate: "spiderman", "mafia2"
    const compact = tokens.map((t) => toNumber(t.raw)).join('');
    if (compact.length < 5) return false;
    return words.some((_, first) => attachedAt(words.slice(first), compact));
  }

  /**
   * compact copre le parole dall'inizio della prima? L'ultima può essere incompleta, ma di almeno
   * due lettere: una sola farebbe leggere "gears" in "Metal Gear Solid".
   */
  function attachedAt(words, compact) {
    let rest = compact;
    for (const word of words) {
      if (rest.startsWith(word)) {
        rest = rest.slice(word.length);
        if (!rest) return true;
      } else {
        // un numero deve essere intero: "forza2" non è "Forza 2005"
        return rest.length >= 2 && !isNumber(rest) && word.startsWith(rest);
      }
    }
    return false;
  }

  /** Prepara un gioco una volta sola, poi si interroga a ogni tasto premuto. */
  function index(game) {
    const main = [entry(`${game.title} ${game.edition ?? ''}`)];
    if (game.titleRaw) main.push(entry(`${game.titleRaw} ${game.edition ?? ''}`));
    const companies = entry(`${game.developer ?? ''} ${game.publisher ?? ''}`);
    const inside = (game.contains ?? []).map((name) => ({ name, ...entry(name) }));
    return { main, companies, inside };
  }

  /**
   * null se non corrisponde. Altrimenti { inside: [...] }: vuoto se corrisponde il gioco stesso,
   * con i nomi dei titoli inclusi se corrisponde solo qualcosa dentro la raccolta.
   */
  function match(indexed, query) {
    const all = variants(query);
    if (!all[0].length) return { inside: [] };
    if (indexed.main.some((e) => all.some((tokens) => entryMatches(tokens, e)))) return { inside: [] };
    const inside = indexed.inside.filter((e) => all.some((tokens) => entryMatches(tokens, e))).map((e) => e.name);
    if (inside.length) return { inside };
    return all.some((tokens) => entryMatches(tokens, indexed.companies, false)) ? { inside: [] } : null;
  }

  globalThis.GASearch = { norm, index, match };
})();
