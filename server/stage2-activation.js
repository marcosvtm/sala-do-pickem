import stageOneCalendar from '../dist/data/schedule.json' with { type: 'json' };
import calendar from '../dist/data/stage2-schedule.json' with { type: 'json' };
import { parseSchedule } from './agenda.js';
import { SOURCE, parsePgl, retrieve } from './results.js';
import { formGames, officialStageTwoField } from './stage2-field.js';
import { stageTwoRatings } from './stage2-ratings.js';

export const STAGE_TWO = 'sg26-s2-v1';
export const threeHours = 3 * 3600000;
const hour = 3600000;
const retryAfter = 60000;
const modelRetryAfter = 300000;
const publishedFields = { vrs: ['vrs'], hltv: ['hltvRank'], elo: ['elo', 'formElo', 'formEvidence'] };
// Stop discovery after the published Stage 2 schedule; its official opening may be delayed.
const discoveryEnds = Math.max(...calendar.games.map(g => g.at));

export function lastSwissSeries(games) {
  const finals = games?.filter(game => game.round === 5 && game.bo === 3 && Number.isFinite(game.at));
  return finals?.length === 3 ? Math.max(...finals.map(game => game.at)) : null;
}
const earliest = lastSwissSeries(stageOneCalendar.games) + threeHours;

function pendingRatings(seeded) {
  return {
    teams: seeded.map(({ id, name, short, logo }) => ({
      id, name, short, logo, vrs: null, hltvRank: null, elo: null, formElo: null, formEvidence: null,
    })),
    modelStatus: { neutral: 'ready', custom: 'ready', study: 'pending', hltv: 'pending', vrs: 'pending', elo: 'pending' },
    sources: {}, modelDates: {},
  };
}

function readyTeam(team, model) {
  if (model === 'hltv') return Number.isInteger(team?.hltvRank) && team.hltvRank > 0;
  if (model === 'vrs') return Number.isFinite(team?.vrs) && team.vrs > 0;
  const evidence = team?.formEvidence;
  const counts = ['series', 'opponents', 'externalOpponents', 'unknownSeries'];
  return Number.isFinite(team?.elo) && Number.isFinite(team?.formElo) &&
    counts.every(key => Number.isInteger(evidence?.[key]) && evidence[key] >= 0) &&
    evidence.opponents <= evidence.series && evidence.externalOpponents <= evidence.opponents &&
    evidence.unknownSeries <= evidence.series;
}

// Only enrich pending predictors. Never change the team order or a predictor already used by a card.
async function enrich(edition, replay, fetcher, rate) {
  const rated = await rate(edition.teams, replay, Date.parse(edition.cutoff), fetcher);
  const candidates = new Map(rated.teams.map(t => [t.id, t]));
  let changed = false;
  for (const [model, fields] of Object.entries(publishedFields)) {
    if (edition.modelStatus[model] === 'ready' || rated.modelStatus[model] !== 'ready' ||
      !edition.teams.every(t => readyTeam(candidates.get(t.id), model))) continue;
    const sourceKey = model === 'elo' ? 'form' : model;
    for (const team of edition.teams) {
      for (const field of fields) team[field] = candidates.get(team.id)[field];
    }
    edition.modelStatus[model] = 'ready';
    edition.sources[sourceKey] = rated.sources[sourceKey];
    edition.modelDates[model] = rated.modelDates?.[model];
    if (model === 'elo') edition.formCoverage = rated.formCoverage;
    changed = true;
  }
  if (changed) edition.revision++;
}

export async function stageTwoActivation(db, now, fetcher, { check = true, rate = stageTwoRatings, defer } = {}) {
  const read = () => db.prepare('SELECT * FROM stage_editions WHERE stage=?').bind(STAGE_TWO).first();
  const unpack = row => ({
    edition: row?.edition ? JSON.parse(row.edition) : null,
    activatedAt: row?.activated_at ?? null,
    attemptedAt: row?.attempted ?? null,
    detail: row?.detail ?? null,
  });
  if (!db) return unpack(null);
  const row = await read();
  const state = unpack(row);
  const previous = state.edition;
  const closesAt = previous ? Date.parse(previous.startsAt) - hour : discoveryEnds;
  const pending = previous && Object.keys(publishedFields).some(key => previous.modelStatus[key] === 'pending');
  if (!check || !fetcher || now < earliest || now >= closesAt || (previous && !pending)) return state;
  const interval = previous ? modelRetryAfter : retryAfter;
  if (row && now - row.attempted < interval) return state;
  if (defer) {
    defer(update());
    return state;
  }
  return update();

  async function update() {
    const claim = await db.prepare(
      'INSERT INTO stage_editions(stage,attempted) VALUES(?,?) ON CONFLICT(stage) DO UPDATE SET attempted=excluded.attempted WHERE stage_editions.attempted=? AND stage_editions.attempted<=?'
    ).bind(STAGE_TWO, now, row?.attempted ?? -1, now - interval).run();
    if (!claim.meta.changes) return unpack(await read());
    const persist = (edition, replay) => db.prepare(
      'UPDATE stage_editions SET activated_at=coalesce(activated_at,?),edition=?,replay=coalesce(replay,?),detail=NULL ' +
      'WHERE stage=? AND attempted=? AND unixepoch()>=? AND unixepoch()<?'
    ).bind(now, JSON.stringify(edition), replay ? JSON.stringify(replay) : null, STAGE_TWO, now,
      Math.ceil(edition.opensNotBefore / 1000), (Date.parse(edition.startsAt) - hour) / 1000).run();
    try {
      let edition = previous, replay;
      if (previous) {
        replay = JSON.parse(row.replay);
      } else {
        const latest = await retrieve(fetcher, SOURCE);
        const lastStart = lastSwissSeries(parseSchedule(latest));
        const opensNotBefore = Math.max(earliest, lastStart + threeHours);
        if (!lastStart || now < opensNotBefore) throw Error('Aguardando o horário de abertura após a última MD3.');
        replay = formGames(latest);
        if (replay.length !== 33) throw Error('Aguardando os 33 resultados oficiais do Stage 1.');
        const opening = await retrieve(fetcher, calendar.source);
        const { seeded, games, startsAt } = officialStageTwoField(opening, latest);
        if (games.some(game => game.status !== 'upcoming') || now >= startsAt - hour)
          throw Error('O prazo para a primeira abertura da edição já terminou.');
        edition = {
          id: STAGE_TWO, version: STAGE_TWO + '-' + now, revision: 0,
          cutoff: new Date(now).toISOString(), startsAt: new Date(startsAt).toISOString(), opensNotBefore,
          games, links: calendar.links, ...pendingRatings(seeded),
        };
        // A clock-triggered opening may be the first visitor since round five. Keep the
        // official S1 points and the catalog default current even in that case.
        await db.prepare(
          'INSERT INTO stage_results(stage,locks,checked,attempted) VALUES(?,?,?,?) ' +
          'ON CONFLICT(stage) DO UPDATE SET locks=excluded.locks, checked=excluded.checked, attempted=excluded.attempted ' +
          'WHERE stage_results.checked<=excluded.checked AND stage_results.attempted<=excluded.attempted'
        ).bind('sg26-s1-v1', JSON.stringify(parsePgl(latest)), now, now).run();
        // Publish the official field before consulting any model provider.
        const opened = await persist(edition, replay);
        if (!opened.meta.changes) return unpack(await read());
      }
      // The field and the neutral predictor are valid even if all model sources are unavailable.
      try { await enrich(edition, replay, fetcher, rate); }
      catch (error) { console.warn('Stage 2 ratings:', error.message); }
      const saved = await persist(edition, null);
      if (saved.meta.changes) return { edition, activatedAt: state.activatedAt ?? now, attemptedAt: now, detail: null };
    } catch (error) {
      // A correction or temporarily incomplete official feed is retried by the next tick.
      await db.prepare('UPDATE stage_editions SET detail=? WHERE stage=? AND attempted=?')
        .bind(String(error.message).slice(0, 240), STAGE_TWO, now).run();
    }
    return unpack(await read());
  }
}
