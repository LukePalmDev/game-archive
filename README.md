# Game Archive

**Sito online: <https://lukepalmdev.github.io/game-archive/>**

Archivio personale della collezione di videogiochi: i titoli vengono letti dalle foto degli scaffali,
arricchiti con metadati e copertine ufficiali da [IGDB](https://www.igdb.com) e consultati in un sito statico.

## Come è fatto

| Pezzo | Dove | Note |
|---|---|---|
| Database | `data/games.db` | SQLite, fonte di verità (via `node:sqlite`, nessuna dipendenza npm) |
| Foto | `photos/` | le foto originali degli scaffali |
| Titoli estratti | `data/extractions/*.json` | un file per foto, generato leggendo l'immagine |
| Script | `scripts/` | import, arricchimento IGDB, export |
| Sito | `site/` | HTML/CSS/JS vanilla, apribile anche con doppio clic (`file://`) |
| Copertine | `site/covers/` | scaricate in locale, il sito funziona offline |

## Prima configurazione (una volta sola)

1. Vai su <https://dev.twitch.tv/console/apps> → **Register Your Application**
   - OAuth Redirect URL: `http://localhost`
   - Category: *Application Integration*
   - Client Type: **Confidential** (serve per avere il Client Secret)
2. `cp .env.example .env` e incolla `IGDB_CLIENT_ID` e `IGDB_CLIENT_SECRET`.
3. `node scripts/init-db.js`

## Flusso di lavoro

```bash
# 1. metti le foto degli scaffali in photos/ e fai estrarre i titoli (→ data/extractions/*.json)
node scripts/import-extraction.js        # carica i titoli nel database

# 2. metadati + copertine da IGDB
node scripts/enrich-igdb.js --limit 5    # prova su pochi titoli
node scripts/enrich-igdb.js              # tutti i pending

# 3. titoli incerti
node scripts/review-report.js            # scrive data/review.md
node scripts/set-match.js --id 42 --igdb 1020
node scripts/set-match.js --id 42 --title "Gran Turismo 4" --platform PS2   # titolo letto male

# 4. pubblica sul sito
node scripts/export-site.js
open site/index.html                     # oppure: node scripts/serve.js
```

## Formato di un file di estrazione

`data/extractions/scaffale-01.json`:

```json
{
  "photo": "scaffale-01.jpg",
  "items": [
    { "title_raw": "Red Dead Redemption 2", "platform": "PS4", "confidence": "high" },
    { "title_raw": "Watch Dogs 2", "platform": "Xbox One", "edition": "Deluxe Edition" },
    { "title_raw": "Forza Motorsport 4", "platform": "Xbox 360", "copies": 2 },
    { "title_raw": "Tomb Ra…er", "platform": "PS3", "confidence": "low", "note": "dorso coperto" }
  ]
}
```

`edition` distingue le edizioni speciali dello stesso gioco (righe separate), `copies` conta le copie
fisiche identiche (una riga sola). Un gioco è unico per titolo + piattaforma + edizione.

`platform` accetta le abbreviazioni comuni (`PS2`, `X360`, `Switch`, `GBA`…): vengono tradotte nei nomi
IGDB da `scripts/lib/platforms.js`. L'import è idempotente: rilanciarlo non crea doppioni.

## Pubblicazione

Ogni push su `main` aggiorna il sito: il workflow `.github/workflows/pages.yml` pubblica la cartella
`site/` su GitHub Pages. Dopo aver modificato l'archivio basta:

```bash
node scripts/export-site.js
git add -A && git commit -m "aggiorna archivio" && git push
```

## Interfaccia

Palette editoriale giapponese anni 80: carta crema, inchiostro nero, accento vermiglio.
Il pulsante ◐ in alto a destra alterna chiaro/scuro (la scelta viene ricordata nel browser);
senza scelta esplicita segue il tema di sistema. `?theme=light` / `?theme=dark` forzano un tema
via URL, `#g=<id>` apre direttamente la scheda di un gioco.

## Stati di un gioco

- `pending` — importato, non ancora cercato su IGDB
- `matched` — trovato con buona confidenza
- `manual` — confermato a mano con `set-match.js`
- `ambiguous` — più candidati plausibili, da confermare (vedi `data/review.md`)
- `not_found` — nessun risultato: probabilmente il titolo è stato letto male

## Note

- IGDB è gratuito per uso non commerciale (Twitch Developer Services Agreement); il client rispetta il
  limite di 4 richieste al secondo.
- `.env`, il token cache e `data/games.db` sono esclusi da git.
