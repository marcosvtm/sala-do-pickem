import baseline from './future-agenda-baseline.json' with { type: 'json' };
import { parseSchedule } from './agenda.js';
import { coverageContext } from './round-scores.js';
import { enrichAgenda, retrieve } from './results.js';
import { ROUND_START } from '../dist/js/swiss.js';
import { SCORE_POLL_MS, SCHEDULE_FRESH_MS } from '../dist/js/schedule.js';
import { majorPhases } from '../dist/js/major-phases.js';
import { stageTwoCandidates } from './stage2-field.js';

const fixtures = new Map([[majorPhases[2].id, baseline.stage3], [majorPhases[3].id, baseline.playoffs]]);
const playoffRounds = ['Quartas de final', 'Semifinais', 'Disputa de 3º lugar', 'Final'];
const logos = new Map(stageTwoCandidates.map(t => [t.id, t.logo]));
for (const name of ['furia.webp', 'aurora_gaming.svg', 'betboom_team.svg', 'falcons.svg',
  'legacy.svg', 'mouz.svg', 'spirit.svg', 'vitality.svg']) logos.set(name.split('.')[0], name);

export function futureAgendaConfig(id) {
  return fixtures.get(id);
}

export function parseFutureAgenda(id, rows, previousTeams = []) {
  const fixture = fixtures.get(id);
  const playoffs = fixture === baseline.playoffs;
  const dates = new Set(fixture.rows.map(row => row.date));
  // PGL's playoff endpoint is shared with other events. Only Singapore match days belong here.
  const relevant = rows.filter(row => dates.has(row.date));
  const teams = previousTeams.map(t => ({ ...t }));
  const teamIndex = new Map(teams.map((t, i) => [t.id, i]));
  const playoffSlots = new Map(fixture.rows.map((row, i) => [row.round.toLowerCase(), i]));
  if (playoffs) {
    const slots = relevant.map(row => playoffSlots.get(row.round?.trim().toLowerCase()));
    if (slots.length !== 8 || slots.includes(undefined) || new Set(slots).size !== 8)
      throw Error('Chave oficial dos playoffs incompleta.');
    relevant.sort((a, b) => playoffSlots.get(a.round.trim().toLowerCase()) - playoffSlots.get(b.round.trim().toLowerCase()));
  }
  for (const row of relevant) {
    for (const side of ['left', 'right']) {
      const key = row[side + 'TeamKey'];
      if (!key) continue;
      if (typeof key !== 'string' || !/^[\w-]{1,80}$/.test(key)) throw Error('Identificação de equipe inválida.');
      const name = row[side + 'Team'], short = row[side + 'Strict'];
      if (!name && !teamIndex.has(key)) continue;
      const team = { id: key, name: name || teams[teamIndex.get(key)].name,
        short: short || name || teams[teamIndex.get(key)].short, logo: logos.get(key) ?? null };
      if (teamIndex.has(key)) teams[teamIndex.get(key)] = team;
      else { teamIndex.set(key, teams.length); teams.push(team); }
    }
  }
  const context = { dates, teamIndex };
  if (playoffs) context.roundOf = row => {
    const i = playoffSlots.get(row.round.trim().toLowerCase());
    return i < 4 ? 1 : i < 6 ? 2 : i - 3;
  };
  const games = parseSchedule(relevant, context, playoffs ? [4, 2, 1, 1] : undefined);
  for (const game of games) {
    if (game.bo !== (playoffs && game.round === 4 ? 5 : 3)) throw Error('Formato oficial inesperado.');
    if (playoffs) game.roundLabel = playoffRounds[game.round - 1];
    const offset = (playoffs ? [0, 4, 6, 7] : ROUND_START)[game.round - 1];
    game.hltvUrl = fixture.rows[offset + game.slot - 1].hltvUrl;
    if (game.status !== 'upcoming' && (game.a == null || game.b == null || game.a === game.b))
      throw Error('Adversários do placar ainda não confirmados.');
  }
  return { teams, games };
}

export async function readFutureAgenda(id, db, now, fetcher) {
  const config = fixtures.get(id);
  const read = () => db.prepare('SELECT schedule,attempted FROM stage_results WHERE stage=?').bind(id).first();
  let row = db ? await read() : null;
  const last = row?.schedule && JSON.parse(row.schedule);
  const initial = last ?? { ...parseFutureAgenda(id, config.rows), checked: null };
  const active = initial.games.some(g => g.status === 'live' ||
    (g.status !== 'end' && Math.abs(now - g.at) <= 6 * 3600000));
  const interval = active ? SCORE_POLL_MS : 30 * 60000;
  const output = data => ({ stage: id, source: config.source,
    teams: data.teams, schedule: data.games, scheduleChecked: data.checked,
    checked: data.checked, stale: !data.checked || now - data.checked > (active ? SCHEDULE_FRESH_MS : interval * 2) });
  if (!db || (row && now - row.attempted < interval)) return output(initial);
  const claim = await db.prepare(
    'INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,\'[]\',0,?) ' +
    'ON CONFLICT(stage) DO UPDATE SET attempted=excluded.attempted WHERE stage_results.attempted<=?'
  ).bind(id, now, now - interval).run();
  if (claim.meta.changes) {
    let fresh;
    try {
      const source = await retrieve(fetcher, config.source);
      const data = parseFutureAgenda(id, source, initial.teams);
      if (data.games.filter(g => g.status === 'end').length >= initial.games.filter(g => g.status === 'end').length)
        fresh = data;
    } catch { /* Retain the last confirmed opponents and seek independent score coverage. */ }
    const teams = (fresh ?? initial).teams;
    const coverage = coverageContext(teams, { games: (fresh ?? initial).games }, id === majorPhases[2].id ? 3 : 4);
    const enriched = await enrichAgenda(fresh?.games, last, initial.games, fetcher, now, coverage);
    if (enriched.checked) {
      const next = { ...enriched, teams };
      const updated = await db.prepare('UPDATE stage_results SET schedule=?,checked=?,attempted=? WHERE stage=? AND attempted=?')
        .bind(JSON.stringify(next), next.checked, now, id, now).run();
      if (updated.meta.changes) return output(next);
    }
  }
  row = await read();
  return output(row?.schedule ? JSON.parse(row.schedule) : initial);
}
