/** Logica condivisa di abbinamento titolo → gioco IGDB. */
import { platformMatches } from './platforms.js';
import { titleSimilarity } from './similarity.js';

export const FIELDS = [
  'name', 'slug', 'url', 'summary', 'first_release_date', 'game_type', 'version_parent',
  'genres.name', 'platforms.name', 'platforms.abbreviation', 'cover.image_id',
  'aggregated_rating', 'rating', 'total_rating', 'total_rating_count',
  'involved_companies.developer', 'involved_companies.publisher', 'involved_companies.company.name',
].join(',');

// game_type: 1 dlc, 2 expansion, 5 mod, 6 episode, 7 season, 13 pack, 14 update — non sono giochi a sé
const DLC_TYPES = new Set([1, 2, 5, 6, 7, 13, 14]);

export function scoreCandidate({ title, platform }, candidate) {
  const sim = titleSimilarity(title, candidate.name);
  let score = sim;
  const platformOk = platformMatches(platform, candidate.platforms ?? []);
  if (platformOk === true) score += 0.12;
  else if (platformOk === false) score -= 0.18;
  if (DLC_TYPES.has(candidate.game_type)) score -= 0.25;
  if (candidate.version_parent) score -= 0.1;
  if ((candidate.total_rating_count ?? 0) > 50) score += 0.03;
  return { sim, score: Math.max(0, Math.min(1.2, score)) };
}

export function rank(game, results) {
  return results
    .map((c) => ({ candidate: c, ...scoreCandidate(game, c) }))
    .sort((a, b) => b.score - a.score);
}

export function companies(candidate, kind) {
  return (candidate.involved_companies ?? [])
    .filter((c) => c[kind])
    .map((c) => c.company?.name)
    .filter(Boolean)
    .join(', ') || null;
}

/** Campi normalizzati pronti per il database, a partire da un gioco IGDB. */
export function toRecord(c) {
  const date = c.first_release_date ? new Date(c.first_release_date * 1000) : null;
  return {
    name: c.name,
    slug: c.slug ?? null,
    year: date ? date.getUTCFullYear() : null,
    date: date ? date.toISOString().slice(0, 10) : null,
    genres: JSON.stringify((c.genres ?? []).map((g) => g.name)),
    developer: companies(c, 'developer'),
    publisher: companies(c, 'publisher'),
    summary: c.summary ?? null,
    rating: c.aggregated_rating ?? c.total_rating ?? c.rating ?? null,
    imageId: c.cover?.image_id ?? null,
    platforms: (c.platforms ?? []).map((p) => p.name),
  };
}
