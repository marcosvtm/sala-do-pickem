import stage from '../dist/data/stage.json' with { type: 'json' };
import schedule from '../dist/data/schedule.json' with { type: 'json' };
import { ctAtRound, matchLink } from '../dist/js/schedule.js';
import { isCurrentMap } from './agenda.js';
import { readCitoScore } from './cito-score.js';
import { broadcastChannel, broadcastMap, readBroadcast } from './cstv.js';

const origin = 'https://draft5.gg';
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export function coverageContext(teams, calendar, stageNumber) {
  const aliases = new Map();
  teams.forEach((team, i) => {
    for (const name of [team.name, team.short, team.id ?? team.logo.split('.')[0]])
      aliases.set(normalize(name), i);
  });
  for (const [alias, team] of Object.entries({
    imperial: 'IMP', dendelecs: 'DEN', lynnvision: 'LVG', parivision: 'PVI', bcgame: 'GOSH',
    navi: 'natus_vincere', g2: 'g2_esports', theone: '1win', mongolz: 'the_mongolz',
  })) {
    const index = aliases.get(normalize(team));
    if (index !== undefined) aliases.set(alias, index);
  }
  const resolveTeam = name => typeof name === 'string' ? aliases.get(normalize(name)) : undefined;
  return { aliases, resolveTeam, calendar, stageNumber };
}
const firstCoverage = coverageContext(stage.teams, schedule, 1);

function inDiscoveryWindow(game, now) {
  return Number.isFinite(game.at) && game.at <= now + 10 * 60000 &&
    now - game.at <= (game.bo === 1 ? 6 : game.bo === 3 ? 9 : 12) * 3600000;
}

function matchingRound(detail, game, stageNumber) {
  const description = String(detail.matchParticularity ?? '').replace(/<[^>]*>/g, ' ');
  if (stageNumber === 'playoffs' || stageNumber === 4) {
    const round = /quartas|quarter.?final/i.test(description) ? 1 :
      /semi.?fina/i.test(description) ? 2 : /terceiro|3[º°o] lugar|third place/i.test(description) ? 3 :
      /(?:grande |grand )?final\b/i.test(description) ? 4 : null;
    return round === game.round && !/\bStage\s+[123]\b/i.test(description);
  }
  return Number(/\bStage\s+(\d+)\b/i.exec(description)?.[1]) === stageNumber &&
    Number(/Rodada\s*#?(\d+)/i.exec(description)?.[1]) === game.round;
}

function findMatches(html, aliases) {
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
function halftimeCT(events, game, mapName, { resolveTeam, aliases }) {
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

function openingReport(events, game, name, before, resolveTeam) {
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
function reportedOpeningCT(rounds, game, mapName, resolveTeam) {
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

function finalRounds(score) {
  if (!score) return false;
  const loser = Math.min(...score);
  const target = loser < 12 ? 13 : 16 + 3 * Math.floor((loser - 12) / 3);
  return Math.max(...score) === target;
}

// DRAFT5's score rows are indexed by map. A veto or a 0-0 row alone is not a played map.
function draftCompletedMaps(game, detail, reversed, now) {
  const rows = [...(detail.scores ?? [])].sort((a, b) => a.seriesOrder - b.seriesOrder);
  const reportedAt = Math.min(now, Number(detail.matchFinishingDate) * 1000 || Date.parse(detail.updatedAt) || now);
  const boards = [];
  const series = [0, 0];
  for (const entry of rows) {
    const raw = entry.map?.mapName;
    const score = reversed ? [entry.scoreB, entry.scoreA] : [entry.scoreA, entry.scoreB];
    if (entry.seriesOrder !== boards.length || !/^de_[a-z0-9_]+$/.test(raw) ||
        !score.every(n => Number.isSafeInteger(n) && n >= 0) || !finalRounds(score)) break;
    const name = raw.slice(3);
    if (game.maps?.[boards.length]?.name && game.maps[boards.length].name !== name) return false;
    boards.push({ name, score, status: 'end' });
    series[Number(score[1] > score[0])]++;
  }
  if (!boards.length || Math.max(...series) > Math.ceil(game.bo / 2) || boards.length > game.bo ||
      series.some((n, i) => n < (game.series?.[i] ?? 0))) return false;
  const officialOrder = reversed ? [detail.seriesScoreB, detail.seriesScoreA] : [detail.seriesScoreA, detail.seriesScoreB];
  if (!series.every((n, i) => n === officialOrder[i])) return false;
  game.series = series;
  const decided = Math.max(...series) === Math.ceil(game.bo / 2);
  if (game.maps) {
    for (const [i, board] of boards.entries()) game.maps[i] = board;
    if (decided) {
      for (let i = boards.length; i < game.maps.length; i++) {
        game.maps[i] = { name: game.maps[i].name, score: null, status: 'unplayed' };
      }
    }
    game.completedMaps = boards.map(map => map.name);
  }
  if (game.bo === 1 || decided) {
    const last = boards.at(-1);
    game.map = { name: last.name, score: last.score, reportedAt, source: 'DRAFT5' };
    game.awaitingOfficial = true;
  } else if (game.completedMaps?.includes(game.map?.name)) game.map = null;
  return true;
}

// A later PGL response can temporarily contain an earlier series or blank map slots.
// Completed rounds stay attached to the same fixture and map. Official finals take precedence.
function retainMapHistory(game, prior) {
  if (!prior?.maps || !game.maps) return;
  const played = (series) => series ? series[0] + series[1] : 0;
  if (game.status !== 'end' && (prior.status === 'end' ||
      (prior.status === 'live' && game.status === 'upcoming') || played(prior.series) > played(game.series))) {
    Object.assign(game, structuredClone(prior));
    return;
  }
  for (const [index, entry] of game.maps.entries()) {
    const old = prior.maps[index];
    if (!old || (entry.name && old.name !== entry.name)) continue;
    entry.name ??= old.name;
    if (entry.status === 'end' && !entry.score && (old.status === 'end' || finalRounds(old.score)))
      entry.score = old.score;
  }
  if (game.status === 'live') {
    game.completedMaps = game.maps.filter((entry) => entry.status === 'end' && entry.name).map((entry) => entry.name);
    const next = game.maps[played(game.series)];
    if (!game.map && next?.name && next.status !== 'unplayed') game.map = { name: next.name, score: next.score };
  } else if (game.status === 'end' && !game.map?.score) {
    const last = game.maps[played(game.series) - 1];
    if (last?.name) game.map = { name: last.name, score: last.score };
  }
}

export async function addRoundScores(games, previous, fetcher, now = Date.now(), broadcast = readBroadcast, coverage = firstCoverage) {
  const { aliases, resolveTeam, calendar, stageNumber } = coverage;
  const previousGame = (g) => previous.find((p) => p.round === g.round && p.bo === g.bo &&
    p.slot === g.slot && p.a === g.a && p.b === g.b);
  for (const game of games) {
    if (game.a == null || game.b == null) continue;
    const prior = previousGame(game);
    if (game.status === 'end' && game.bo === 1 && !game.map?.score && finalRounds(prior?.map?.score) &&
        (!game.map?.name || game.map.name === prior.map.name) &&
        game.series?.[Number(prior.map.score[1] > prior.map.score[0])] === 1)
      game.map = { ...prior.map };
    if (game.status === 'upcoming' && prior?.status === 'live' && inDiscoveryWindow(game, now)) {
      // PGL may keep publishing the timetable after a game has verifiably started.
      Object.assign(game, { status: 'live', series: prior.series, map: prior.map });
      if (prior.maps) game.maps = structuredClone(prior.maps);
      if (prior.completedMaps) game.completedMaps = [...prior.completedMaps];
      if (prior.liveSource) game.liveSource = prior.liveSource;
      if (prior.awaitingOfficial) game.awaitingOfficial = true;
    }
    if (game.bo > 1) retainMapHistory(game, prior);
  }
  const live = games.filter(g => g.a != null && g.b != null && (g.status === 'live' ||
    (g.status === 'upcoming' && inDiscoveryWindow(g, now))));
  if (!live.length) return;
  let listing;
  const broadcasts = new Map();
  function channelFrame(channel) {
    if (!broadcasts.has(channel)) broadcasts.set(channel, broadcast(channel, fetcher));
    return broadcasts.get(channel);
  }
  await Promise.all(live.map(async (row) => {
    // Stage a read-only probe. A scheduled time or a pre-game map announcement is never proof of play.
    const discovering = row.status === 'upcoming';
    const g = discovering ? { ...row, status: 'live', series: [0, 0], map: null,
      ...(row.maps && { maps: structuredClone(row.maps) }) } : row;
    let confirmedBy;
    const prior = previousGame(g);
    const scoreboard = readCitoScore(g, g.hltv ?? matchLink(g, calendar), resolveTeam, fetcher, now, discovering);
    const lastRead = prior?.broadcastChecked;
    let streams;
    if (('stream' in g || discovering) && (!lastRead || now - lastRead >= 45000)) {
      const channel = broadcastChannel(g.stream);
      streams = Promise.all((channel ? [channel] : ['a', 'b']).map(channelFrame));
      g.broadcastChecked = now;
    } else if (lastRead) g.broadcastChecked = lastRead;
    let match = prior?.coverage;
    if (prior?.map?.score && prior.map.reportedAt && isCurrentMap(g, prior.map.name) &&
        (!g.map?.score || prior.map.score.every((n, i) => n >= g.map.score[i]))) {
      g.map = { ...prior.map };
    } else if (g.maps && g.map?.score) {
      // PGL provides rounds without a last-update time; use the first observation of this score.
      g.map.reportedAt = now;
      g.map.source = 'PGL';
    }
    try {
      if (!match || (g.bo > 1 || (g.liveSource && (!g.map?.reportedAt || now - g.map.reportedAt > 60000))) &&
          match.checked != null && now - match.checked >= 45000) {
        if (!match) listing ??= request(fetcher, '/').then((r) => r.text()).then(html => findMatches(html, aliases));
        const candidate = match ?? (await listing).find((m) =>
          (m.a === g.a && m.b === g.b) || (m.b === g.a && m.a === g.b));
        if (!candidate) return;
        const data = await request(fetcher, '/api/proxy/matches/' + candidate.id).then(r => r.json())
          .then(body => body.data).catch(() => null);
        if (data?.teamA && data?.teamB) {
          const a = resolveTeam(data.teamA.teamName), b = resolveTeam(data.teamB.teamName);
          if (data.tournament?.tournamentId !== 1801 || data.bestOf !== g.bo || !matchingRound(data, g, stageNumber) ||
              !((a === g.a && b === g.b) || (b === g.a && a === g.b))) return;
          match = { id: candidate.id, reversed: a !== g.a, checked: now };
          if (draftCompletedMaps(g, data, match.reversed, now)) confirmedBy = 'DRAFT5';
        } else if (!match) return;
      }
      g.coverage = { ...match, checked: match.checked ?? now };
      const { data } = await (await request(fetcher, '/api/proxy/matches/' + match.id + '/live')).json();
      const rounds = data.filter((e) =>
        /^de_[a-z0-9_]+$/i.test(e.map?.name) && isCurrentMap(g, e.map.name.slice(3)) && Number.isFinite(e.eventDate) &&
        [e.scoreA, e.scoreB].every((n) => Number.isSafeInteger(n) && n >= 0) &&
        (g.bo === 1 || e.scoreA + e.scoreB > 0 || /começ(?:a|ou) (?:o (?:jogo|mapa)|a partida)/i.test(e.title ?? ''))
      ).sort((a, b) => b.eventDate - a.eventDate || b.id - a.id);
      const event = rounds[0];
      if (event && event.eventDate * 1000 >= now - 8 * 60000 && event.eventDate * 1000 <= now + 30000 &&
          (event.scoreA + event.scoreB > 0 || /começ(?:a|ou) (?:o (?:jogo|mapa)|a partida)/i.test(event.title ?? '')))
        confirmedBy = 'DRAFT5';
      if (discovering && !confirmedBy && event) return;
      const first = rounds.findLast((e) => e.map.name === event?.map.name);
      const report = openingReport(data, g, event?.map.name.slice(3) ?? g.map?.name, first?.eventDate ?? now / 1000, resolveTeam);
      if (!event) {
        if (report) {
          g.map ??= { name: report.name };
          g.map.startingCT = report.startingCT;
          if (g.bo === 1 && !g.map.score)
            Object.assign(g.map, { score: [0, 0], reportedAt: report.reportedAt, source: 'DRAFT5' });
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
      const startingCT = report?.startingCT ?? halftimeCT(data, g, event.map.name, coverage) ??
        reportedOpeningCT(rounds, g, event.map.name, resolveTeam);
      if (startingCT !== undefined) g.map.startingCT = startingCT;
    } catch {
      // The PGL status and last known round remain usable between coverage updates.
    } finally {
      const frame = await scoreboard;
      if (frame && (!g.map || frame.name === g.map.name)) {
        if (frame.score) confirmedBy = 'Cito';
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
        confirmedBy = 'CSTV PGL';
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
      if (g.maps && g.series && g.map) {
        const entry = g.maps[g.series[0] + g.series[1]];
        if (entry && entry.status !== 'unplayed' && (!entry.name || entry.name === g.map.name)) {
          entry.name = g.map.name;
          if (g.map.score) {
            entry.score = g.map.score;
            entry.status = 'live';
          }
        }
      }
      if (g.bo === 1 && finalRounds(g.map?.score)) g.awaitingOfficial = true;
      if (discovering) {
        if (confirmedBy) Object.assign(row, g, { liveSource: confirmedBy });
        else {
          if (g.broadcastChecked) row.broadcastChecked = g.broadcastChecked;
          if (g.coverage) row.coverage = g.coverage;
        }
      }
    }
  }));
}
