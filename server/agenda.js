import stage from '../dist/data/stage.json' with { type: 'json' };
import { ROUND_SIZES } from '../dist/js/swiss.js';

const teamIndex = new Map(stage.teams.map((t, i) => [t.logo.split('.')[0], i]));
export function isCurrentMap(game, name) {
  if (game.map?.name) return game.map.name === name;
  if (game.bo === 1) return true;
  const completed = game.completedMaps ?? [];
  return game.bo === 3 && game.series && completed.length === game.series[0] + game.series[1] &&
    !completed.includes(name);
}
export function* stageRows(source) {
  if (!Array.isArray(source)) throw Error('Agenda inválida');
  for (const row of source) {
    if (!/^(24|25|26|27)\.11\.2026$/.test(row.date)) continue;
    const round = row.round?.startsWith('opening round')
      ? 1
      : Number(/^round ([2-5])\b/.exec(row.round)?.[1]);
    if (!Number.isInteger(round)) throw Error('Rodada desconhecida');
    yield {
      row,
      round,
      maps: row.maps ?? [],
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
    const played = maps
      .filter((m) => m.leftScore + m.rightScore > 0)
      .at(-1);
    const status =
      row.status === 'end'
        ? 'end'
        : row.status === 'live' ||
            (a !== null && b !== null && (sa + sb > 0 || played))
          ? 'live'
          : 'upcoming';
    const map = status === 'end' ? played : maps[sa + sb];
    const knownMap = /^de_[a-z0-9_]+$/i.test(map?.map);
    games.push({
      round,
      slot,
      at,
      a,
      b,
      bo: Number(row.format.slice(2)),
      status,
      ...(status === 'live' ? { stream: row.stream ?? null } : {}),
      ...(status === 'live' && row.format === 'BO3' ? {
        completedMaps: maps.slice(0, sa + sb).map((m) => m.map)
          .filter((name) => /^de_[a-z0-9_]+$/i.test(name)).map((name) => name.slice(3)),
      } : {}),
      ...(status !== 'upcoming'
        ? {
            series:
              Number.isInteger(sa) && Number.isInteger(sb) ? [sa, sb] : null,
            map: knownMap
              ? {
                  name: map.map.replace(/^de_/, ''),
                  score: Number.isInteger(map.leftScore) && Number.isInteger(map.rightScore) &&
                    map.leftScore >= 0 && map.rightScore >= 0 && map.leftScore + map.rightScore > 0
                    ? [map.leftScore, map.rightScore] : null,
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
