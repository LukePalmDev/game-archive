import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ROOT } from './db.js';

const TOKEN_CACHE = join(ROOT, '.igdb-token.json');
const API = 'https://api.igdb.com/v4';

export function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) {
    throw new Error('Manca il file .env — copia .env.example in .env e inserisci le credenziali IGDB.');
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  const { IGDB_CLIENT_ID, IGDB_CLIENT_SECRET } = process.env;
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET non valorizzati in .env');
  }
  return { clientId: IGDB_CLIENT_ID, clientSecret: IGDB_CLIENT_SECRET };
}

async function getToken({ clientId, clientSecret }) {
  if (existsSync(TOKEN_CACHE)) {
    const cached = JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
    if (cached.client_id === clientId && cached.expires_at > Date.now() + 60_000) return cached.access_token;
  }
  const url = new URL('https://id.twitch.tv/oauth2/token');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('grant_type', 'client_credentials');

  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`Autenticazione Twitch fallita (${res.status}): ${await res.text()}`);
  const body = await res.json();
  writeFileSync(TOKEN_CACHE, JSON.stringify({
    client_id: clientId,
    access_token: body.access_token,
    expires_at: Date.now() + body.expires_in * 1000,
  }, null, 2));
  return body.access_token;
}

/** IGDB consente 4 richieste/secondo: serializziamo con un intervallo minimo. */
const MIN_INTERVAL_MS = 260;
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function createClient() {
  const creds = loadEnv();
  const token = await getToken(creds);
  const headers = {
    'Client-ID': creds.clientId,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  return async function query(endpoint, apicalypse, attempt = 0) {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();

    const res = await fetch(`${API}/${endpoint}`, { method: 'POST', headers, body: apicalypse });
    if (res.status === 429 && attempt < 5) {
      await sleep(1000 * (attempt + 1));
      return query(endpoint, apicalypse, attempt + 1);
    }
    if (!res.ok) throw new Error(`IGDB ${endpoint} (${res.status}): ${await res.text()}`);
    return res.json();
  };
}

export const COVER_SIZE = 't_cover_big_2x';

export function coverUrl(imageId, size = COVER_SIZE) {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

export async function downloadCover(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download copertina fallito (${res.status}): ${url}`);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
  return destPath;
}
