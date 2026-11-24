import { DemoReader, EntityMode, HttpBroadcastReader, TeamNumber } from 'cs2parser/browser';
import snappy from 'snappyjs';
import { ctAtRound } from '../dist/js/schedule.js';
import { isCurrentMap } from './agenda.js';

const channels = { main: 'a', secondary: 'b' };
export const broadcastChannel = (stream) => Object.hasOwn(channels, stream) ? channels[stream] : null;
const unpack = (bytes, output) => {
  const decoded = snappy.uncompress(bytes, 16 * 1024 * 1024);
  if (!output) return decoded;
  output.set(decoded);
  return output.subarray(0, decoded.length);
};

export function broadcastMap(frame, game, resolveTeam, now) {
  if (!frame || frame.warmup || !['first', 'second', 'halftime'].includes(frame.phase) ||
      !/^de_[a-z0-9_]+$/.test(frame.map)) return null;
  const name = frame.map.slice(3);
  const ct = resolveTeam(frame.ct), tr = resolveTeam(frame.tr);
  if (!isCurrentMap(game, name) || ct == null || tr == null || ct === tr ||
      ![game.a, game.b].includes(ct) || ![game.a, game.b].includes(tr)) return null;
  if (![frame.ctScore, frame.trScore].every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const rounds = frame.ctScore + frame.trScore;
  if (rounds !== frame.rounds) return null;

  let startingCT;
  if (rounds < 12 && frame.phase === 'first') startingCT = ct;
  else if (rounds > 12 && rounds < 24 && frame.phase === 'second') startingCT = tr;
  // At a half boundary the old uniforms may still be visible. Wait one round
  // for first-time evidence; an already recorded opening side still applies.
  else if (rounds > 24 && (rounds - 24) % 3 !== 0)
    startingCT = ctAtRound(game.a, game.b, ct, rounds + 1);
  return {
    name, score: ct === game.a ? [frame.ctScore, frame.trScore] : [frame.trScore, frame.ctScore],
    source: 'CSTV PGL', reportedAt: now - 180000,
    ...(startingCT != null ? { startingCT } : {}),
  };
}

const failures = new Map();
export async function readBroadcast(channel, fetcher) {
  if (channel !== 'a' && channel !== 'b') return null;
  const base = 'https://cstv.fragnet.net/' + channel + '/';
  const get = async (path, signal) => {
    const response = await fetcher(base + path, { signal, cache: 'no-store' });
    if (!response.ok) throw Error('HTTP ' + response.status);
    return response;
  };
  const parser = new DemoReader();
  // This pinned browser reader exposes its per-instance Snappy adapter. Workers
  // cannot compile the default decoder's WASM at runtime.
  parser._snappy = { uncompress: unpack, uncompressFrame: unpack };
  const reader = new HttpBroadcastReader(parser, base, {
    entities: EntityMode.ALL, entityClasses: ['CCSTeam', 'CCSGameRulesProxy'],
    gameEventDescriptors: false, maxFullRetries: 0, signal: AbortSignal.timeout(8000),
    fetcher: {
      json: async (path, signal) => (await get(path, signal)).json(),
      bytes: async (path, signal) => ({ ok: true, data: new Uint8Array(await (await get(path, signal)).arrayBuffer()) }),
    },
  });
  try {
    const result = await reader.start();
    const rules = parser.gameRules;
    if (result.status !== 'ready' || !rules || reader.sync.rcvage > 45) return null;
    const ct = parser.teams.find((t) => t.teamNumber === TeamNumber.CounterTerrorists);
    const tr = parser.teams.find((t) => t.teamNumber === TeamNumber.Terrorists);
    if (!ct || !tr) return null;
    failures.delete(channel);
    return {
      map: reader.sync.map, warmup: rules.isWarmup, phase: rules.phase, rounds: rules.roundsPlayed,
      ct: ct.clanName, ctScore: ct.score, tr: tr.clanName, trScore: tr.score,
    };
  } catch (error) {
    if (failures.get(channel) !== error.message) console.warn('CSTV PGL', channel, error.message);
    failures.set(channel, error.message);
    return null;
  } finally {
    reader.stop();
  }
}
