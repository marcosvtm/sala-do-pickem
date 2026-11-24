import stage from '../dist/data/stage.json' with { type: 'json' };

const origin = 'https://draft5.gg';
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map();
stage.teams.forEach((team, i) => {
  for (const name of [team.name, team.short, team.logo.split('.')[0]])
    aliases.set(normalize(name), i);
});
for (const [alias, team] of Object.entries({
  imperial: 'IMP', dendelecs: 'DEN', lynnvision: 'LVG', parivision: 'PVI',
})) aliases.set(alias, aliases.get(normalize(team)));

function findMatches(html) {
  const matches = [];
  const links = /href="\/partida\/(\d+)-([^"/]+?)-vs-([^"/]+?)-PGL-Major-Singapore-2026"/gi;
  for (const [, id, left, right] of html.matchAll(links)) {
    const a = aliases.get(normalize(left)), b = aliases.get(normalize(right));
    if (a !== undefined && b !== undefined && a !== b)
      matches.push({ id, a, b });
  }
  return matches;
}

async function request(fetcher, path) {
  const response = await fetcher(origin + path, {
    signal: AbortSignal.timeout(4000), cache: 'no-store',
  });
  if (!response.ok) throw Error('Cobertura indisponível');
  return response;
}

// Live commentary sometimes announces both starting sides before the first round.
function openingCT(events, game, mapName, firstRoundAt) {
  for (const event of events) {
    if (!Number.isFinite(event.eventDate) || event.eventDate > firstRoundAt ||
        (event.scoreA ?? 0) !== 0 || (event.scoreB ?? 0) !== 0) continue;
    if (event.map?.name ? event.map.name !== mapName : game.bo !== 1) continue;
    const sides = new Map();
    const announcement = (event.description ?? '').replace(/\*/g, '');
    for (const clause of announcement.split(/[,;:.!?\n]|\s+e\s+/i)) {
      const parts = /^(?:[ao]\s+)?(.+?)\s+(?:(?:vem|começa|inicia)\s+)?(?:de|como)\s+(CT|TR|T)$/i.exec(clause.trim());
      if (!parts) continue;
      const team = aliases.get(normalize(parts[1]));
      if (team === game.a || team === game.b)
        sides.set(team, parts[2].toUpperCase() === 'CT' ? 'CT' : 'TR');
    }
    if (sides.size === 2 && sides.get(game.a) !== sides.get(game.b))
      return sides.get(game.a) === 'CT' ? game.a : game.b;
  }
}

export async function addRoundScores(games, previous, fetcher) {
  const live = games.filter((g) => g.status === 'live' && (g.map || g.bo === 1) && g.a !== null && g.b !== null);
  if (!live.length) return;
  let listing;
  await Promise.all(live.map(async (g) => {
    const prior = previous.find((p) => p.round === g.round && p.a === g.a && p.b === g.b);
    let match = prior?.coverage;
    if (prior?.map?.reportedAt && (prior.map.name === g.map?.name || (!g.map && g.bo === 1)) &&
        (!g.map?.score || prior.map.score[0] + prior.map.score[1] > g.map.score[0] + g.map.score[1])) {
      g.map = { ...prior.map };
    }
    try {
      if (!match) {
        listing ??= request(fetcher, '/').then((r) => r.text()).then(findMatches);
        const candidate = (await listing).find((m) =>
          (m.a === g.a && m.b === g.b) || (m.b === g.a && m.a === g.b));
        if (!candidate) return;
        const { data } = await (await request(fetcher, '/api/proxy/matches/' + candidate.id)).json();
        const a = aliases.get(normalize(data.teamA.teamName)), b = aliases.get(normalize(data.teamB.teamName));
        if (data.tournament?.tournamentId !== 1801 || data.bestOf !== g.bo ||
            !/Stage 1\b/i.test(data.matchParticularity) ||
            Number(/Rodada\s*#?(\d+)/i.exec(data.matchParticularity)?.[1]) !== g.round ||
            !((a === g.a && b === g.b) || (b === g.a && a === g.b))) return;
        match = { id: candidate.id, reversed: a !== g.a };
      }
      g.coverage = match;
      const { data } = await (await request(fetcher, '/api/proxy/matches/' + match.id + '/live')).json();
      const rounds = data.filter((e) =>
        /^de_[a-z0-9_]+$/i.test(e.map?.name) && (!g.map || e.map.name === 'de_' + g.map.name) && Number.isFinite(e.eventDate) &&
        [e.scoreA, e.scoreB].every((n) => Number.isSafeInteger(n) && n >= 0)
      ).sort((a, b) => b.eventDate - a.eventDate || b.id - a.id);
      const event = rounds[0];
      if (!event || event.eventDate * 1000 < (g.map?.reportedAt ?? 0)) return;
      const keepPglScore = !g.map?.reportedAt && g.map?.score &&
        event.scoreA + event.scoreB <= g.map.score[0] + g.map.score[1];
      if (!keepPglScore) {
        g.map = {
          name: event.map.name.slice(3),
          score: match.reversed ? [event.scoreB, event.scoreA] : [event.scoreA, event.scoreB],
          reportedAt: event.eventDate * 1000,
        };
      }
      const startingCT = openingCT(data, g, event.map.name, rounds.at(-1).eventDate);
      if (startingCT !== undefined) g.map.startingCT = startingCT;
    } catch {
      // The PGL status and last known round remain usable between coverage updates.
    } finally {
      if (g.map && g.map.name === prior?.map?.name && prior.map.startingCT != null)
        g.map.startingCT ??= prior.map.startingCT;
    }
  }));
}
