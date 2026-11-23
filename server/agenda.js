import stage from '../dist/data/stage.json' with { type: 'json' };
import { ROUND_SIZES } from '../dist/js/swiss.js';

const teamIndex = new Map(stage.teams.map((t, i) => [t.logo.split('.')[0], i]));
const fields = (source) =>
  Object.fromEntries(
    [...source.matchAll(/(?:^\{|,)(\w+):(?:"([^"]*)"|(\d+))/g)].map((m) => [
      m[1],
      m[2] ?? m[3],
    ])
  );
export function* stageRows(source) {
  for (const match of source.matchAll(
    /(\{leftTeam:"[^{}]{0,3000}?),maps:\[([^\]]{0,6000})\]/g
  )) {
    const row = fields(match[1]);
    if (!/^(24|25|26|27)\.11\.2026$/.test(row.date)) continue;
    const round = row.round?.startsWith('opening round')
      ? 1
      : Number(/^round ([2-5])\b/.exec(row.round)?.[1]);
    if (!Number.isInteger(round)) throw Error('Rodada desconhecida');
    yield {
      row,
      round,
      maps: [...match[2].matchAll(/\{[^{}]*\}/g)].map((m) => fields(m[0])),
    };
  }
}
export function parseSchedule(source) {
  const counts = Array(5).fill(0),
    games = [];
  for (const { row, round, maps } of stageRows(source)) {
    const slot = ++counts[round - 1];
    const [day, month, year] = row.date.split('.');
    const at = Date.parse(
      year + '-' + month + '-' + day + 'T' + row.time + ':00+08:00'
    );
    if (row.timeZone !== 'SGT' || !Number.isFinite(at))
      throw Error('Horário desconhecido');
    const a = teamIndex.get(row.leftTeamKey) ?? null,
      b = teamIndex.get(row.rightTeamKey) ?? null;
    const sa = Number(row.leftScore),
      sb = Number(row.rightScore);
    const map = maps
      .filter((m) => Number(m.leftScore) + Number(m.rightScore) > 0)
      .at(-1);
    const status =
      row.status === 'end'
        ? 'end'
        : row.status === 'live' ||
            (a !== null && b !== null && (sa + sb > 0 || map))
          ? 'live'
          : 'upcoming';
    games.push({
      round,
      slot,
      at,
      a,
      b,
      bo: Number(row.format.slice(2)),
      status,
      ...(status === 'live'
        ? {
            series:
              Number.isInteger(sa) && Number.isInteger(sb) ? [sa, sb] : null,
            map: map
              ? {
                  name: map.map.replace(/^de_/, ''),
                  score: [Number(map.leftScore), Number(map.rightScore)],
                }
              : null,
          }
        : {}),
    });
  }
  if (counts.some((v, i) => v !== ROUND_SIZES[i]))
    throw Error('Agenda incompleta');
  return games;
}
