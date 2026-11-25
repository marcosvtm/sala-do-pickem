import { availableGames, ROUND_SIZES } from '../dist/js/swiss.js';
import { stageRows, parseSchedule, readScore, seriesWon, firstAgenda, agendaContext } from './agenda.js';
import { addRoundScores, coverageContext } from './round-scores.js';
import { SCORE_POLL_MS } from '../dist/js/schedule.js';
import baseSchedule from '../dist/data/schedule.json' with { type: 'json' };
import stage from '../dist/data/stage.json' with { type: 'json' };

export const SOURCE =
  'https://news.pglesports.com/api/groupStageEndpoint?stage=1';
export const emptyLocks = () => Array(33).fill(-1);
export const START = Date.parse(stage.startsAt);
export const CLOSE = START - 60 * 60 * 1000;

// Only completed PGL matches can settle the official bracket.
export function parsePgl(source, previous, context = firstAgenda) {
  const rounds = [[], [], [], [], []],
    sizes = [0, 0, 0, 0, 0];
  const previousRounds = previous && availableGames(previous);
  for (const { row: fields, round } of stageRows(source, context)) {
    const r = round - 1;
    sizes[r]++;
    if (fields.status !== 'end') continue;
    const a = context.teamIndex.get(fields.leftTeamKey),
      b = context.teamIndex.get(fields.rightTeamKey);
    const bo = Number(fields.format?.slice(2));
    const score = readScore(fields.leftScore, fields.rightScore);
    if (
      a === undefined ||
      b === undefined ||
      a === b ||
      ![1, 3].includes(bo)
    )
      throw new Error('Resultado incompleto');
    if (seriesWon(bo, score)) {
      rounds[r].push({ a, b, bo, winner: score[0] > score[1] ? a : b });
    } else if (previousRounds) {
      // A partial update can coincide with another match finishing. Keep an
      // already verified winner only for these same opponents, round and format.
      const known = previousRounds[r]?.find((g) => g.bo === bo &&
        ((g.a === a && g.b === b) || (g.a === b && g.b === a)));
      if (known && previous[known.match] >= 0)
        rounds[r].push({ a, b, bo, winner: previous[known.match] ? known.b : known.a });
    }
  }
  if (sizes.some((n, r) => n !== ROUND_SIZES[r]))
    throw new Error('Formato da fonte mudou');
  const locks = emptyLocks();
  for (let r = 0; r < 5; r++) {
    const draws = availableGames(locks)[r] ?? [];
    for (const row of rounds[r]) {
      const g = draws.find(
        (g) =>
          g.bo === row.bo &&
          ((g.a === row.a && g.b === row.b) || (g.b === row.a && g.a === row.b))
      );
      if (!g || locks[g.match] !== -1)
        throw new Error('Resultado fora da chave');
      locks[g.match] = Number(row.winner === g.b);
    }
  }
  return locks;
}
export async function retrieve(fetcher = fetch, source = SOURCE) {
  const response = await fetcher(source, {
    signal: AbortSignal.timeout(7000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('PGL indisponível');
  return response.json();
}
export function createSwissResultReader(edition, source, calendar = edition) {
  const context = agendaContext(edition.teams, calendar.games);
  const coverage = coverageContext(edition.teams, calendar, Number(new URL(source).searchParams.get('stage')));
  const config = { id: edition.id, start: Date.parse(edition.startsAt), context, coverage, calendar, source };
  return (db, now = Date.now(), fetcher = fetch, includeSchedule = false) =>
    readSwissResults(config, db, now, fetcher, includeSchedule);
}
export const liveResults = createSwissResultReader(stage, SOURCE, baseSchedule);

async function readSwissResults(
  config,
  db,
  now,
  fetcher,
  includeSchedule
) {
  if (now < config.start && !includeSchedule)
    return { locks: emptyLocks(), checked: null, stale: false };
  const read = () =>
    db
      .prepare('SELECT * FROM stage_results WHERE stage=?')
      .bind(config.id)
      .first();
  let row = await read();
  const output = (r) => ({
    locks: r ? JSON.parse(r.locks) : emptyLocks(),
    checked: r?.checked || null,
    ...(includeSchedule
      ? {
          schedule: r?.schedule
            ? JSON.parse(r.schedule).games
            : config.calendar.games,
          scheduleChecked: r?.schedule ? JSON.parse(r.schedule).checked : null,
        }
      : {}),
    stale:
      !r?.checked ||
      r.attempted - r.checked > 15000 ||
      now - r.checked > 180000,
  });
  const retryAfter = row?.attempted > row?.checked ? 30000 : SCORE_POLL_MS;
  if (row && now - row.attempted < retryAfter) return output(row);
  const claim = await db
    .prepare(
      `INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,0,?)
    ON CONFLICT(stage) DO UPDATE SET attempted=excluded.attempted WHERE stage_results.attempted<=?`
    )
    .bind(config.id, JSON.stringify(emptyLocks()), now, now - retryAfter)
    .run();
  if (claim.meta.changes) {
    let verified, games;
    const stored = row?.schedule ? JSON.parse(row.schedule) : null;
    const oldGames = stored?.games ?? [];
    const source = await retrieve(fetcher, config.source).catch(() => null);
    if (source) {
      try {
        const old = row ? JSON.parse(row.locks) : emptyLocks();
        const locks = parsePgl(source, old, config.context);
        if (
          locks.filter((x) => x >= 0).length >= old.filter((x) => x >= 0).length
        )
          verified = JSON.stringify(locks);
      } catch {
        /* The on-screen agenda can still be updated if pairing verification fails. */
      }
      try {
        const fresh = parseSchedule(source, config.context);
        if (fresh.filter(g => g.status === 'end').length >= oldGames.filter(g => g.status === 'end').length)
          games = fresh;
      } catch {
        /* Keep the previous schedule if a date or round is missing. */
      }
    }
    const enriched = await enrichAgenda(games, stored, config.calendar.games, fetcher, now, config.coverage);
    await db.prepare(
      'UPDATE stage_results SET locks=coalesce(?,locks), schedule=coalesce(?,schedule), checked=coalesce(?,checked) WHERE stage=? AND attempted=?'
    ).bind(verified ?? null, enriched.checked ? JSON.stringify(enriched) : null,
      verified ? now : null, config.id, now).run();
  }
  return output(await read());
}

export async function enrichAgenda(games, stored, fallback, fetcher, now, coverage) {
  // Round coverage can outlive the PGL calendar; it never settles official picks.
  const freshCalendar = Boolean(games);
  games ??= structuredClone(stored?.games ?? fallback);
  let checked = freshCalendar ? now : stored?.checked ?? 0;
  try {
    await addRoundScores(games, stored?.games ?? [], fetcher, now, undefined, coverage);
    if (!freshCalendar) {
      for (const game of games) {
        if (game.status === 'live' && Number.isFinite(game.map?.reportedAt))
          checked = Math.max(checked, Math.min(now, game.map.reportedAt));
      }
    }
  } catch {
    // A coverage failure still allows official locks and schedule to advance.
  }
  return { games, checked };
}
