import stage from '../dist/data/stage.json' with { type: 'json' };
import { ROUND_SIZES } from '../dist/js/swiss.js';

const teamIndex = new Map(stage.teams.map((t, i) => [t.logo.split('.')[0], i]));
export function isCurrentMap(game, name) {
  if (!name || game.status === 'end') return false;
  if (game.maps && !game.maps.some((map) => map.status === 'upcoming' || map.status === 'live'))
    return false;
  if (game.map?.name) return game.map.name === name;
  if (game.bo === 1) return true;
  const completed = game.completedMaps ?? [];
  return game.bo > 1 && game.series && completed.length === game.series[0] + game.series[1] &&
    !completed.includes(name) && !game.maps?.slice(completed.length + 1).some((map) => map.name === name);
}

export function readScore(left, right) {
  const values = [left, right].map((n) => typeof n === 'string' && /^\d+$/.test(n) ? Number(n) : n);
  return values.every((n) => Number.isSafeInteger(n) && n >= 0) ? values : null;
}

export function seriesWon(bo, score) {
  const target = Math.floor(bo / 2) + 1;
  return Boolean(score && Math.max(...score) === target && Math.min(...score) < target);
}

function readMap(raw, row) {
  const name = /^de_[a-z0-9_]+$/i.test(raw?.map) ? raw.map.slice(3).toLowerCase() : null;
  if (!raw) return { name, score: null };
  let score = readScore(raw.leftScore, raw.rightScore);
  if (raw.leftTeamKey || raw.rightTeamKey) {
    if (raw.leftTeamKey === row.rightTeamKey && raw.rightTeamKey === row.leftTeamKey) score?.reverse();
    else if (raw.leftTeamKey !== row.leftTeamKey || raw.rightTeamKey !== row.rightTeamKey) score = null;
  }
  return { name, score: score?.some((n) => n > 0) ? score : null };
}

function mapHistory(boards, completed, decided, status) {
  return boards.map(({ name, score }, index) => {
    if (index < completed) return { name, score, status: 'end' };
    if (decided) return { name, score: null, status: 'unplayed' };
    if (index === completed && status === 'live' && score) return { name, score, status: 'live' };
    return { name, score: null, status: 'upcoming' };
  });
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
    const bo = Number(row.format.slice(2));
    if (![1, 3, 5].includes(bo)) throw Error('Formato de série desconhecido');
    const series = readScore(row.leftScore, row.rightScore);
    const completed = series ? series[0] + series[1] : 0;
    const boards = Array.from({ length: bo }, (_, index) => readMap(maps[index], row));
    const decided = seriesWon(bo, series);
    const status =
      row.status === 'end' && decided
        ? 'end'
        : row.status === 'live' ||
            (a !== null && b !== null && (completed > 0 || boards.some((board) => board.score)))
          ? 'live'
          : 'upcoming';
    const board = status === 'end' ? boards[completed - 1] : boards[completed];
    const map = board?.name ? { ...board } : null;
    games.push({
      round,
      slot,
      at,
      a,
      b,
      bo,
      status,
      ...(status === 'live' ? { stream: row.stream ?? null } : {}),
      ...(bo > 1 ? { maps: mapHistory(boards, completed, decided, status) } : {}),
      ...(status === 'live' && bo > 1 ? {
        completedMaps: boards.slice(0, completed).map((m) => m.name).filter(Boolean),
      } : {}),
      ...(status !== 'upcoming' ? { series, map: status === 'live' && decided ? null : map } : {}),
    });
  }
  if (counts.some((v, i) => v !== ROUND_SIZES[i]))
    throw Error('Agenda incompleta');
  return games;
}
