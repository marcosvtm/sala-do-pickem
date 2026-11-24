import stage from '../dist/data/stage.json' with { type: 'json' };
import schedule from '../dist/data/schedule.json' with { type: 'json' };
import { ctAtRound, matchLink } from '../dist/js/schedule.js';
import { isCurrentMap } from './agenda.js';
import { readCitoScore } from './cito-score.js';
import { broadcastChannel, broadcastMap, readBroadcast } from './cstv.js';

const origin = 'https://draft5.gg';
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = new Map();
stage.teams.forEach((team, i) => {
  for (const name of [team.name, team.short, team.logo.split('.')[0]])
    aliases.set(normalize(name), i);
});
for (const [alias, team] of Object.entries({
  imperial: 'IMP', dendelecs: 'DEN', lynnvision: 'LVG', parivision: 'PVI', bcgame: 'GOSH',
})) aliases.set(alias, aliases.get(normalize(team)));
const resolveTeam = (name) => typeof name === 'string' ? aliases.get(normalize(name)) : undefined;

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

// Some matches announce sides only in the first-half recap.
function halftimeCT(events, game, mapName) {
  for (const event of events) {
    if (event.map?.name !== mapName || !Number.isFinite(event.eventDate) ||
        ![event.scoreA, event.scoreB].every((n) => Number.isInteger(n) && n >= 0) ||
        event.scoreA + event.scoreB !== 12) continue;
    const recap = (event.description ?? '').replace(/\*/g, '').trim();
    const parts = /^fim (?:do primeiro tempo|da primeira metade) com (?:[ao] )?(.+?) (?:confirmando|terminando|encerrando|fechando|abrindo)\b([^.!?;]*?)\bjogando de (CT|TR|T)\b/i.exec(recap);
    if (!parts) continue;
    const team = resolveTeam(parts[1]);
    if (team !== game.a && team !== game.b) continue;
    const opponent = team === game.a ? game.b : game.a;
    const clause = normalize(parts[2]);
    // A second team in the clause would make the side attribution ambiguous.
    if ([...aliases].some(([name, id]) => id === opponent && clause.includes(name))) continue;
    return parts[3].toUpperCase() === 'CT' ? team : opponent;
  }
}

// DRAFT5 may put the map and a single starting side only in the pre-game text.
function announcedMap(event) {
  const structured = event.map?.name;
  if (structured) return /^de_[a-z0-9_]+$/i.test(structured) ? structured.slice(3).toLowerCase() : undefined;
  const maps = new Set((event.description ?? '').toLowerCase()
    .match(/\b(?:ancient|anubis|cache|cobblestone|dust\s?2|inferno|mirage|nuke|overpass|train|vertigo)\b/g)
    ?.map((name) => name.replace(/\s/g, '')));
  return maps.size === 1 ? [...maps][0] : undefined;
}

function openingReport(events, game, name, before) {
  const evidence = new Set();
  let reportedAt = 0, mapName = name;
  for (const event of events) {
    if (!Number.isFinite(event.eventDate) || event.eventDate > before ||
        (event.scoreA ?? 0) !== 0 || (event.scoreB ?? 0) !== 0) continue;
    const named = announcedMap(event);
    if ((!named && game.bo !== 1) || (named && (name && named !== name || !isCurrentMap(game, named)))) continue;
    const announcement = (event.description ?? '').replace(/\*/g, '');
    for (let clause of announcement.split(/[,;:.!?\n]|\s+e\s+/i)) {
      // "Teremos Ancient com a PVISION começando de CT!"
      clause = clause.trim().replace(/^(?:teremos|vamos (?:de|ter))\s+[\w -]+?\s+com\s+/i, '');
      const parts = /^(?:[ao]\s+)?(.+?)\s+(?:(?:vem|começa|começou|começará|começando|inicia|iniciou|iniciando|vai começar)\s+)?(?:de|como|do lado)\s+(?:de\s+)?(CT|TR|T)$/i.exec(clause);
      if (!parts) continue;
      const team = resolveTeam(parts[1]);
      if (team !== game.a && team !== game.b) continue;
      const ct = parts[2].toUpperCase() === 'CT' ? team : (team === game.a ? game.b : game.a);
      evidence.add(ct);
      if (named && mapName && named !== mapName) return null;
      mapName ??= named;
      reportedAt = Math.max(reportedAt, event.eventDate * 1000);
    }
  }
  return mapName && evidence.size === 1 ? { name: mapName, startingCT: [...evidence][0], reportedAt } : null;
}

// Use named, side-specific actions in scored rounds. The team that won a round
// alone does not identify its side. Conflicting reports leave it undetermined.
function reportedOpeningCT(rounds, game, mapName) {
  const evidence = new Set();
  for (const event of rounds) {
    if (event.map.name !== mapName) continue;
    const round = event.scoreA + event.scoreB;
    const sentences = (event.description ?? '').replace(/\*/g, '').split(/[!?;\n]|\.(?:\s|$)/);
    for (const sentence of sentences) {
      let teamCT;
      const defense = /\b(?:entrada|entrar|invadir|invasão|ataque)\b[^!?;]*?\b(?:pela|na|contra a) defesa (?:da|do|de) (.+)$/i.exec(sentence);
      if (defense) teamCT = resolveTeam(defense[1].trim());
      const action = /^(?:[ao] )?(.+?)\s+(desarma|defusa|planta|arma) (?:a |o )?(?:bomba|c4)\b/i.exec(sentence.trim());
      if (action) {
        const team = resolveTeam(action[1]);
        if (team === game.a || team === game.b)
          teamCT = /^(desarma|defusa)$/i.test(action[2]) ? team : (team === game.a ? game.b : game.a);
      }
      const opening = ctAtRound(game.a, game.b, teamCT, round);
      if (opening != null) evidence.add(opening);
    }
  }
  if (evidence.size === 1) return [...evidence][0];
}

export async function addRoundScores(games, previous, fetcher, now = Date.now(), broadcast = readBroadcast) {
  const live = games.filter((g) => g.status === 'live' && g.a !== null && g.b !== null);
  if (!live.length) return;
  let listing;
  const broadcasts = new Map();
  function channelFrame(channel) {
    if (!broadcasts.has(channel)) broadcasts.set(channel, broadcast(channel, fetcher));
    return broadcasts.get(channel);
  }
  await Promise.all(live.map(async (g) => {
    const prior = previous.find((p) => p.round === g.round && p.bo === g.bo && p.a === g.a && p.b === g.b);
    const scoreboard = readCitoScore(g, matchLink(g, schedule), resolveTeam, fetcher, now);
    const sameMap = prior?.map && isCurrentMap(g, prior.map.name);
    const lastRead = sameMap ? prior.broadcastChecked : null;
    let streams;
    if ('stream' in g && (!lastRead || now - lastRead >= 45000)) {
      const channel = broadcastChannel(g.stream);
      streams = Promise.all((channel ? [channel] : ['a', 'b']).map(channelFrame));
      g.broadcastChecked = now;
    } else if (lastRead) g.broadcastChecked = lastRead;
    let match = prior?.coverage;
    if (prior?.map?.reportedAt && isCurrentMap(g, prior.map.name) &&
        (!g.map?.score || prior.map.score.every((n, i) => n >= g.map.score[i]))) {
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
        /^de_[a-z0-9_]+$/i.test(e.map?.name) && isCurrentMap(g, e.map.name.slice(3)) && Number.isFinite(e.eventDate) &&
        [e.scoreA, e.scoreB].every((n) => Number.isSafeInteger(n) && n >= 0)
      ).sort((a, b) => b.eventDate - a.eventDate || b.id - a.id);
      const event = rounds[0];
      const first = rounds.findLast((e) => e.map.name === event?.map.name);
      const report = openingReport(data, g, event?.map.name.slice(3) ?? g.map?.name, first?.eventDate ?? now / 1000);
      if (!event) {
        if (report) {
          g.map ??= { name: report.name };
          g.map.startingCT = report.startingCT;
          if (!g.map.score) Object.assign(g.map, { score: [0, 0], reportedAt: report.reportedAt, source: 'DRAFT5' });
        }
        return;
      }
      const score = match.reversed ? [event.scoreB, event.scoreA] : [event.scoreA, event.scoreB];
      if (!g.map?.score || (score.every((n, i) => n >= g.map.score[i]) &&
          score.some((n, i) => n > g.map.score[i]))) {
        g.map = {
          name: event.map.name.slice(3),
          score,
          reportedAt: event.eventDate * 1000,
        };
      }
      const startingCT = report?.startingCT ?? halftimeCT(data, g, event.map.name) ??
        reportedOpeningCT(rounds, g, event.map.name);
      if (startingCT !== undefined) g.map.startingCT = startingCT;
    } catch {
      // The PGL status and last known round remain usable between coverage updates.
    } finally {
      const frame = await scoreboard;
      if (frame && (!g.map || frame.name === g.map.name)) {
        const before = g.map;
        if (frame.score && (!before?.score || (frame.score.every((n, i) => n >= before.score[i]) &&
            (frame.reportedAt >= (before.reportedAt ?? 0) || frame.score.some((n, i) => n > before.score[i])))))
          g.map = frame;
        const startingCT = frame.startingCT ?? before?.startingCT;
        if (startingCT != null) {
          g.map ??= { name: frame.name, score: null };
          g.map.startingCT = startingCT;
        }
      }
      if (prior?.map?.startingCT != null && isCurrentMap(g, prior.map.name)) {
        g.map ??= { name: prior.map.name, score: null };
        if (prior.map.sideSource === 'CSTV PGL') {
          g.map.startingCT = prior.map.startingCT;
          g.map.sideSource = prior.map.sideSource;
        } else g.map.startingCT ??= prior.map.startingCT;
      }
      for (const raw of (await streams) ?? []) {
        const map = broadcastMap(raw, g, resolveTeam, now);
        if (!map) continue;
        const before = g.map;
        if (!before?.score || (map.score.every((n, i) => n >= before.score[i]) &&
            map.score.some((n, i) => n > before.score[i]))) {
          g.map = { ...before, ...map };
        }
        if (map.startingCT != null) {
          g.map.startingCT = map.startingCT;
          g.map.sideSource = 'CSTV PGL';
        }
      }
    }
  }));
}
