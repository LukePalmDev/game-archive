#!/usr/bin/env node
/** Scrive data/review.md con i titoli da confermare a mano. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb, ROOT } from './lib/db.js';

const db = openDb();
const games = db.prepare(`
  SELECT * FROM games WHERE match_status IN ('ambiguous', 'not_found') ORDER BY match_status, id
`).all();
const candidatesFor = db.prepare('SELECT * FROM match_candidates WHERE game_id = ? ORDER BY score DESC');

const lines = ['# Titoli da confermare', ''];
if (!games.length) {
  lines.push('Tutto risolto: nessun match incerto. 🎉');
} else {
  lines.push(`${games.length} titoli da sistemare. Per confermarne uno:`, '', '```bash', 'node scripts/set-match.js --id <id-gioco> --igdb <id-igdb>', '```', '');
  for (const g of games) {
    lines.push(`## #${g.id} — ${g.title_raw}${g.platform ? ` _(${g.platform})_` : ''}`);
    lines.push(`Stato: **${g.match_status}** · foto: ${g.source_photo ?? '—'}${g.notes ? ` · note: ${g.notes}` : ''}`);
    const cands = candidatesFor.all(g.id);
    if (cands.length) {
      lines.push('', '| IGDB id | Nome | Anno | Piattaforme | Punteggio |', '|---|---|---|---|---|');
      for (const c of cands) lines.push(`| ${c.igdb_id} | ${c.name} | ${c.year ?? '—'} | ${c.platforms ?? '—'} | ${c.score} |`);
    } else {
      lines.push('', '_Nessun candidato: titolo probabilmente letto male dalla foto._');
    }
    lines.push('');
  }
}

const out = join(ROOT, 'data', 'review.md');
writeFileSync(out, lines.join('\n'));
console.log(`Report scritto in ${out} (${games.length} titoli da confermare)`);
db.close();
