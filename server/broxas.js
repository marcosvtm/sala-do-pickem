const SOURCE = 'https://rankingbroxas.duckdns.org/api/months';
const monthClock = new Intl.DateTimeFormat('en', {
  timeZone: 'America/Cuiaba',
  year: 'numeric',
  month: 'numeric',
});
const nickKey = (nick) =>
  nick
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
let cache;

export function monthProfiles(months, year, month) {
  if (!Array.isArray(months)) throw Error('Formato mensal indisponível');
  const period = year * 12 + month;
  const past = months
    .filter((m) => m.year * 12 + m.month <= period)
    .sort((a, b) => b.year - a.year || b.month - a.month);
  const latest = past[0];
  if (!latest) return [];
  if (!Array.isArray(latest.monthStats?.players))
    throw Error('Estatísticas indisponíveis');
  const current = latest.year === year && latest.month === month;
  // The Chopp table ranks eligible players by score, keeping source order on ties.
  const choppPlaces = new Map(
    latest.monthStats.players
      .filter((p) => p.participates && Number.isFinite(p.notaTotal))
      .sort((a, b) => b.notaTotal - a.notaTotal)
      .map((p, index) => [p.ratingColumn, index + 1])
  );
  const levels = new Map();
  for (const m of past) {
    for (const match of m.matches || []) {
      const at = Date.parse(match.gameFinishedAt);
      if (!Number.isFinite(at)) continue;
      for (const [column, stats] of Object.entries(match.statsByColumn || {})) {
        if (
          Number.isInteger(stats?.gcLevel) &&
          at > (levels.get(column)?.at ?? -Infinity)
        )
          levels.set(column, { at, level: stats.gcLevel });
      }
    }
  }
  return latest.monthStats.players
    .filter((p) => typeof p.name === 'string')
    .map((p) => ({
      name: p.name,
      level: levels.get(p.ratingColumn)?.level ?? null,
      choppPlace: current ? choppPlaces.get(p.ratingColumn) ?? null : null,
      score: current && Number.isFinite(p.notaTotal) ? p.notaTotal : null,
      games: current && Number.isInteger(p.jogos) ? p.jogos : null,
    }));
}

export function matchProfile(profiles, nick) {
  const exact = profiles.filter(
    (p) => p.name.toLowerCase() === nick.toLowerCase()
  );
  if (exact.length === 1) return exact[0];
  const key = nickKey(nick);
  if (!key) return null;
  const possible = profiles.filter((p) => nickKey(p.name) === key);
  return possible.length === 1 ? possible[0] : null;
}

export async function broxasProfile(nick, now, fetcher) {
  const parts = Object.fromEntries(
    monthClock.formatToParts(now).map((p) => [p.type, p.value])
  );
  const year = Number(parts.year),
    month = Number(parts.month);
  const sameMonth = cache?.year === year && cache?.month === month;
  let stale = false;
  if (!sameMonth || now - cache.at >= 10 * 60000) {
    try {
      const response = await fetcher(SOURCE, {
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw Error();
      const profiles = monthProfiles(await response.json(), year, month);
      cache = { profiles, year, month, at: now };
    } catch {
      if (!sameMonth || now - cache.at > 86400000) return { unavailable: true };
      stale = true;
    }
  }
  return { member: matchProfile(cache.profiles, nick), year, month, stale };
}
