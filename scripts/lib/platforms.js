/** Alias delle piattaforme: come le scrivo io -> nome canonico usato su IGDB. */
const ALIASES = {
  'ps1': 'PlayStation', 'psx': 'PlayStation', 'playstation 1': 'PlayStation',
  'ps2': 'PlayStation 2', 'ps3': 'PlayStation 3', 'ps4': 'PlayStation 4', 'ps5': 'PlayStation 5',
  'psp': 'PlayStation Portable', 'ps vita': 'PlayStation Vita', 'psvita': 'PlayStation Vita', 'vita': 'PlayStation Vita',
  'xbox': 'Xbox', 'xbox 360': 'Xbox 360', 'x360': 'Xbox 360',
  'xbox one': 'Xbox One', 'xone': 'Xbox One',
  'xbox series': 'Xbox Series X|S', 'xbox series x': 'Xbox Series X|S', 'series x': 'Xbox Series X|S',
  'switch': 'Nintendo Switch', 'nsw': 'Nintendo Switch', 'switch 2': 'Nintendo Switch 2',
  'wii': 'Wii', 'wii u': 'Wii U', 'gamecube': 'Nintendo GameCube', 'ngc': 'Nintendo GameCube',
  'n64': 'Nintendo 64', 'snes': 'Super Nintendo Entertainment System', 'nes': 'Nintendo Entertainment System',
  'gb': 'Game Boy', 'gbc': 'Game Boy Color', 'gba': 'Game Boy Advance',
  'ds': 'Nintendo DS', 'nds': 'Nintendo DS', '3ds': 'Nintendo 3DS',
  'pc': 'PC (Microsoft Windows)', 'windows': 'PC (Microsoft Windows)', 'steam': 'PC (Microsoft Windows)',
  'mac': 'Mac', 'linux': 'Linux',
  'dreamcast': 'Dreamcast', 'saturn': 'Sega Saturn', 'mega drive': 'Sega Mega Drive/Genesis',
  'megadrive': 'Sega Mega Drive/Genesis', 'genesis': 'Sega Mega Drive/Genesis', 'master system': 'Sega Master System',
  'amiga': 'Amiga', 'c64': 'Commodore C64/128/MAX',
};

export function canonicalPlatform(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  return ALIASES[raw.toLowerCase()] ?? raw;
}

/** true se una delle piattaforme IGDB del gioco corrisponde a quella indicata. */
export function platformMatches(wanted, igdbPlatforms = []) {
  const target = canonicalPlatform(wanted).toLowerCase();
  if (!target) return null;
  return igdbPlatforms.some((p) => {
    const name = String(p.name ?? '').toLowerCase();
    const abbr = String(p.abbreviation ?? '').toLowerCase();
    return name === target || abbr === target || name.includes(target) || (abbr && target.includes(abbr));
  });
}
