import { ctAtRound } from '../dist/js/schedule.js';
import { isCurrentMap } from './agenda.js';

// The public match page embeds the same live state it uses to draw its scoreboard.
function findState(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (node.entityType === 'cs2_live_state' && node.matchId === id) return node;
  for (const child of Object.values(node)) {
    const state = findState(child, id);
    if (state) return state;
  }
  return null;
}

export function publicLiveState(html, id) {
  const chunks = [];
  for (const [, script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const prefix = 'self.__next_f.push(';
    if (!script.startsWith(prefix + '[1,')) continue;
    const [, chunk] = JSON.parse(script.slice(prefix.length, script.lastIndexOf(')')));
    if (typeof chunk === 'string') chunks.push(chunk);
  }
  for (const line of chunks.join('').split('\n')) {
    if (!line.includes('"entityType":"cs2_live_state"')) continue;
    const start = line.indexOf(':') + 1;
    if (line[start] !== '[' && line[start] !== '{') continue;
    const state = findState(JSON.parse(line.slice(start)), id);
    if (state) return state;
  }
  return null;
}

export function mapSnapshot(state, game, resolveTeam, now) {
  if (!state?.dataAvailable || state.status !== 'live' || state.source !== 'live' ||
      !/^de_[a-z0-9_]+$/i.test(state.currentMap)) return null;
  const name = state.currentMap.slice(3);
  if (!isCurrentMap(game, name)) return null;
  const first = resolveTeam(state.teams?.team1Name), second = resolveTeam(state.teams?.team2Name);
  if (!((first === game.a && second === game.b) || (first === game.b && second === game.a))) return null;
  const scores = [state.score?.team1, state.score?.team2];
  if (!scores.every((s) => Number.isSafeInteger(s) && s >= 0)) return null;
  const reportedAt = Date.parse(state.latestSnapshot?.capturedAt ?? state.lastVerified);
  if (!Number.isFinite(reportedAt) || reportedAt > now + 30000) return null;
  const map = { name, score: first === game.a ? scores : scores.reverse(), reportedAt, source: 'Cito' };
  const round = state.currentRound, played = scores[0] + scores[1];
  if (Number.isInteger(round) && round >= 1 && (round === played || round === played + 1) &&
      ['team1', 'team2'].includes(state.ctTeam) && state.tTeam === (state.ctTeam === 'team1' ? 'team2' : 'team1')) {
    const ct = state.ctTeam === 'team1' ? first : second;
    map.startingCT = ctAtRound(first, second, ct, round);
    if (round === played + 1) {
      map.currentCT = ct;
      map.sideRound = round;
    }
  }
  // The opening side is a fact about this map even after the live score expires.
  if (now - reportedAt > 180000)
    return map.startingCT == null ? null : { name, startingCT: map.startingCT };
  return map;
}

const canonicalLinks = new Map();
const lastFailure = new Map();
function unavailable(id, reason) {
  if (lastFailure.get(id) !== reason) console.warn('Live scoreboard', id, reason);
  lastFailure.set(id, reason);
  return null;
}
export async function readCitoScore(game, link, resolveTeam, fetcher, now, discovering = false) {
  const match = /^https:\/\/www\.hltv\.org\/matches\/(\d+)\/([^/?#]+)/.exec(link ?? '');
  if (!match) return null;
  const id = 'cs2-match-' + match[1];
  const base = 'https://cito.gg/matches/' + id;
  const slug = match[2].split('-pgl-major-singapore-2026')[0].replace(/\bbcgame\b/g, 'bc-game');
  const url = canonicalLinks.get(id) ?? (slug.includes('-vs-') ? base + '/' + slug : base);
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(9000), cache: 'no-store' });
    if (!response.ok) return unavailable(id, 'HTTP ' + response.status);
    if (response.url.startsWith(base + '/')) canonicalLinks.set(id, response.url);
    const state = publicLiveState(await response.text(), id);
    if (!state) return unavailable(id, 'No live snapshot');
    if (discovering && !((state.currentRound ?? 0) > 0 || (state.score?.team1 + state.score?.team2) > 0))
      return null;
    const frame = mapSnapshot(state, game, resolveTeam, now);
    if (frame) lastFailure.delete(id);
    return frame;
  } catch (error) {
    return unavailable(id, error.name);
  }
}
