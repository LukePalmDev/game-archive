# Game Archive

**Sito online: <https://games.byluke.org>**

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
| Consigli | `data/recommendations.json` | titoli suggeriti, con motivo e giochi di riferimento |
| Copertine | `site/covers/` | scaricate in locale: nessuna richiesta a servizi esterni |

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

# 4. rigenera il sito
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

`platform` accetta le abbreviazioni comuni (`PS2`, `X360`, `Switch`, `GBA`…): `import-extraction.js`
le traduce nei nomi IGDB con `scripts/lib/platforms.js`. L'import è idempotente: riconosce un gioco
già presente dal titolo letto sulla foto (anche se IGDB lo ha poi rinominato), più piattaforma ed
edizione, ignorando maiuscole, punteggiatura e numeri romani, e non crea doppioni.

`enrich-igdb.js` accetta da solo un abbinamento solo se la piattaforma coincide esattamente e non è un
DLC: negli altri casi il gioco finisce in `data/review.md`. `--status all --force` rielabora tutto
tranne le conferme manuali.

## Giochi consigliati

Il tasto **?** in alto a sinistra apre `consigliati.html`: stessa impaginazione dell'archivio, ma
popolata da un catalogo di titoli da comprare, costruito analizzando la collezione. Tre criteri:

| Etichetta | Criterio |
|---|---|
| `SAGA` | capitoli mancanti di serie che possiedi (hai 1 e 2 → ti propone il 3) |
| `EDIZIONE` | remaster, collection ed edizioni definitive di giochi che hai già |
| `AFFINE` | titoli vicini per genere, studio o struttura a quelli che collezioni |

I consigli si scrivono a mano in `data/recommendations.json` (titolo, piattaforma, motivo e giochi
di riferimento) e poi si arricchiscono con IGDB come l'archivio:

```bash
node scripts/import-recommendations.js
node scripts/enrich-recommendations.js
node scripts/export-site.js
```

Il file è la fonte di verità: una voce tolta dal JSON viene tolta anche dal database al successivo
import.

**Un consiglio che possiedi non compare sul sito.** `export-site.js` lo ricalcola ogni volta
confrontando gli id IGDB con la collezione, compreso ciò che sta dentro le raccolte e le edizioni
speciali (possiedi *Mafia: Trilogy* → *Mafia II: Definitive Edition* sparisce). L'elenco di cosa
contiene ogni custodia viene da IGDB e si aggiorna da solo con `enrich-igdb.js`,
`enrich-recommendations.js` e `set-match.js`; a mano: `node scripts/sync-contents.js`.

### Dopo un acquisto

```bash
# aggiungi i titoli in un nuovo file di data/extractions/, poi:
node scripts/import-extraction.js
node scripts/enrich-igdb.js
node scripts/export-site.js      # elenca i consigli nascosti perché ora sono tuoi
```

## Pubblicazione

Ogni push su `main` aggiorna il sito: il workflow `.github/workflows/pages.yml` pubblica la cartella
`site/` su GitHub Pages, servita su <https://games.byluke.org>.

Il dominio sta in `site/CNAME` (`games.byluke.org`). Il file deve restare in quella cartella: è la
directory che il workflow carica, e un deploy senza CNAME toglie il dominio dalle impostazioni di
Pages. Link, script, copertine e favicon sono percorsi relativi, quindi il sito sta alla radice del
dominio (non sotto `/game-archive/`) e si apre anche in locale con `site/index.html` o
`node scripts/serve.js`.

In **Settings → Pages → Custom domain** deve comparire `games.byluke.org`, e l'indirizzo `http://`
deve rimandare a `https://`: senza HTTPS l'uso offline non si attiva.

Dopo aver modificato l'archivio basta:

```bash
node scripts/export-site.js
git add -A && git commit -m "aggiorna archivio" && git push
```

## Interfaccia

Palette editoriale giapponese anni 80: carta crema, inchiostro nero, accento vermiglio.
Il pulsante ◐ in alto a destra alterna chiaro/scuro (la scelta viene ricordata nel browser);
senza scelta esplicita segue il tema di sistema. `?theme=light` / `?theme=dark` forzano un tema
via URL, `#g=<id>` apre direttamente la scheda di un gioco.

### Ricerca

La ricerca (`site/search.js`) serve a capire in fretta se un gioco c'è già: ignora apostrofi e
punteggiatura, equipara numeri arabi e romani (`forza 4`, `mafia 2`), capisce le sigle (`gta`, `cod4`,
`tlou`, `pes`) e le parole attaccate (`spiderman`), e cerca anche **dentro le raccolte**:
`bioshock infinite` mostra *BioShock: The Collection* con la fascia «Contiene BioShock Infinite».
`?q=halo` apre una pagina con la ricerca già compilata.

### Uso senza rete

Alla prima visita il sito salva pagine, dati e copertine (circa 20 MB). Quando in testata compare
**Pronto offline ✓** si apre anche in modalità aereo. Con la rete, pagine e dati arrivano sempre
aggiornati; se non risponde entro 3 secondi si usa la copia salvata (`site/sw.js`). Le copertine
vengono lette dalla copia salvata: se ne sostituisci una mantenendo il nome, cambia `ga-covers-v1` in
`site/sw.js` e `site/offline.js`.

Sul telefono i filtri si aprono con il pulsante **Filtri**.

## Stati di un gioco

- `pending` — importato, non ancora cercato su IGDB
- `matched` — trovato con buona confidenza
- `manual` — confermato a mano con `set-match.js`
- `ambiguous` — più candidati plausibili, da confermare (vedi `data/review.md`)
- `not_found` — nessun risultato: probabilmente il titolo è stato letto male

## Note

- IGDB è gratuito per uso non commerciale (Twitch Developer Services Agreement); il client rispetta il
  limite di 4 richieste al secondo.
- `.env`, il token cache, `data/games.db` e `data/backups/` sono esclusi da git.
