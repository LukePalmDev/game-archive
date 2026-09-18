import { normalizeTitle } from './db.js';

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Coefficiente di Dice sui bigrammi: 1 = identici, 0 = nulla in comune. */
export function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a), B = bigrams(b);
  let shared = 0, total = 0;
  for (const [g, n] of A) { total += n; shared += Math.min(n, B.get(g) ?? 0); }
  for (const [, n] of B) total += n;
  return (2 * shared) / total;
}

/**
 * Similarità fra un titolo letto dalla foto e un nome IGDB.
 * Premia i titoli identici e quelli contenuti (es. "Halo 3" vs "Halo 3: ODST").
 */
export function titleSimilarity(readTitle, igdbName) {
  const a = normalizeTitle(readTitle);
  const b = normalizeTitle(igdbName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = diceCoefficient(a, b);
  const contained = b.startsWith(a) || a.startsWith(b) ? 0.9 : (b.includes(a) || a.includes(b) ? 0.82 : 0);
  let score = Math.max(dice, contained);

  // I numeri distinguono i capitoli di una serie: "Gran Turismo 4" non e' "Gran Turismo 5".
  const numsA = a.match(/\d+/g) ?? [];
  const numsB = b.match(/\d+/g) ?? [];
  if (numsA.length && numsB.length && numsA.join() !== numsB.join()) score *= 0.55;
  else if (numsA.length !== numsB.length) score *= 0.85;

  return score;
}
