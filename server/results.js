import { availableGames, ROUND_SIZES } from '../dist/js/swiss.js';
import { stageRows, parseSchedule } from './agenda.js';
import baseSchedule from '../dist/data/schedule.json' with { type: 'json' };
import stage from '../dist/data/stage.json' with { type: 'json' };

export const SOURCE =
  'https://www.pglesports.com/cs2/pgl-major-singapore-2026/';
const byKey = new Map(
  stage.teams.map((team, i) => [team.logo.split('.')[0], i])
);
export const emptyLocks = () => Array(33).fill(-1);
export const START = Date.parse(stage.startsAt);
export const CLOSE = START - 60 * 60 * 1000;

// PGL ships the event's structured schedule in its public page chunk. Read named
// scalar fields only; the page also contains live scores and later Major stages.
export function parsePgl(source) {
  const rounds = [[], [], [], [], []],
    sizes = [0, 0, 0, 0, 0];
  for (const { row: fields, round } of stageRows(source)) {
    const r = round - 1;
    sizes[r]++;
    if (fields.status !== 'end') continue;
    const a = byKey.get(fields.leftTeamKey),
      b = byKey.get(fields.rightTeamKey);
    const bo = Number(fields.format?.slice(2)),
      x = Number(fields.leftScore),
      y = Number(fields.rightScore);
    if (
      a === undefined ||
      b === undefined ||
      a === b ||
      ![1, 3].includes(bo) ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x === y ||
      Math.min(x, y) < 0
    )
      throw new Error('Resultado incompleto');
    rounds[r].push({ a, b, bo, winner: x > y ? a : b });
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
export async function retrieve(fetcher = fetch) {
  const options = { signal: AbortSignal.timeout(7000) };
  const page = await fetcher(SOURCE, options);
  if (!page.ok) throw new Error('PGL indisponível');
  const path =
    /<script[^>]+src="([^"]*\/app\/cs2\/pgl-major-singapore-2026\/page-[^"]+\.js)"/.exec(
      await page.text()
    )?.[1];
  if (!path) throw new Error('Agenda indisponível');
  const url = new URL(path, SOURCE);
  if (url.origin !== new URL(SOURCE).origin)
    throw new Error('Origem inesperada');
  const asset = await fetcher(url, { signal: AbortSignal.timeout(7000) });
  if (!asset.ok) throw new Error('Agenda indisponível');
  return asset.text();
}
export async function liveResults(
  db,
  now = Date.now(),
  fetcher = fetch,
  includeSchedule = false
) {
  if (now < START && !includeSchedule)
    return { locks: emptyLocks(), checked: null, stale: false };
  const read = () =>
    db
      .prepare('SELECT * FROM stage_results WHERE stage=?')
      .bind(stage.id)
      .first();
  let row = await read();
  const output = (r) => ({
    locks: r ? JSON.parse(r.locks) : emptyLocks(),
    checked: r?.checked || null,
    ...(includeSchedule
      ? {
          schedule: r?.schedule
            ? JSON.parse(r.schedule).games
            : baseSchedule.games,
          scheduleChecked: r?.schedule ? JSON.parse(r.schedule).checked : null,
        }
      : {}),
    stale:
      !r?.checked ||
      r.attempted - r.checked > 15000 ||
      now - r.checked > 180000,
  });
  if (row && now - row.attempted < 60000) return output(row);
  const claim = await db
    .prepare(
      `INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,0,?)
    ON CONFLICT(stage) DO UPDATE SET attempted=excluded.attempted WHERE stage_results.attempted<=?`
    )
    .bind(stage.id, JSON.stringify(emptyLocks()), now, now - 60000)
    .run();
  if (claim.meta.changes) {
    try {
      const source = await retrieve(fetcher);
      let verified, schedule;
      try {
        const locks = parsePgl(source);
        const old = row ? JSON.parse(row.locks) : emptyLocks();
        if (
          locks.filter((x) => x >= 0).length >= old.filter((x) => x >= 0).length
        )
          verified = JSON.stringify(locks);
      } catch {
        /* The on-screen agenda can still be updated if pairing verification fails. */
      }
      try {
        const games = parseSchedule(source);
        const old = row?.schedule ? JSON.parse(row.schedule).games : [];
        if (
          games.filter((g) => g.status === 'end').length >=
          old.filter((g) => g.status === 'end').length
        )
          schedule = JSON.stringify({ games, checked: now });
      } catch {
        /* Keep the previous schedule if a date or round is missing. */
      }
      await db
        .prepare(
          'UPDATE stage_results SET locks=coalesce(?,locks), schedule=coalesce(?,schedule), checked=coalesce(?,checked) WHERE stage=? AND attempted=?'
        )
        .bind(
          verified ?? null,
          schedule ?? null,
          verified ? now : null,
          stage.id,
          now
        )
        .run();
    } catch {
      /* Keep the previous verified board and mark it stale. */
    }
  }
  return output(await read());
}
