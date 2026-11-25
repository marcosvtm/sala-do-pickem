import { futureAgendaConfig, readFutureAgenda } from './future-agenda.js';
import stageOneSchedule from '../dist/data/schedule.json' with { type: 'json' };
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import stageTwoInvites from '../dist/data/stage2-invites.json' with { type: 'json' };
import stageTwoSchedule from '../dist/data/stage2-schedule.json' with { type: 'json' };
import stageTwoEdition from '../dist/data/edition-s2.json' with { type: 'json' };
import { CLOSE, SOURCE, START, emptyLocks, liveResults, createSwissResultReader } from './results.js';
import { lastSwissSeries, STAGE_TWO, threeHours } from './stage2-activation.js';
import { majorPhases } from '../dist/js/major-phases.js';
import { SCORE_POLL_MS, SCHEDULE_FRESH_MS } from '../dist/js/schedule.js';

// Unscoped links and requests from the first release always refer to this roster.
export const LEGACY_STAGE_ID = stageOne.id;
const localStartDay = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit',
});
const stageTwoStart = stageTwoEdition ? Date.parse(stageTwoEdition.startsAt)
  : Math.min(...stageTwoSchedule.games.map((game) => game.at));
const phases = [
  {
    id: LEGACY_STAGE_ID,
    name: 'Stage 1',
    startsAt: START,
    lastSeriesAt: lastSwissSeries(stageOneSchedule.games),
    closesAt: CLOSE,
    rosterConfirmed: true,
    source: SOURCE,
    readResults: liveResults,
  },
  {
    id: STAGE_TWO,
    name: 'Stage 2',
    startsAt: stageTwoStart,
    lastSeriesAt: lastSwissSeries(stageTwoEdition?.games ?? stageTwoSchedule.games),
    closesAt: stageTwoStart - 60 * 60 * 1000,
    rosterConfirmed: Boolean(stageTwoEdition),
    ...(stageTwoEdition && {
      teams: stageTwoEdition.teams,
      editionVersion: stageTwoEdition.version,
      readResults: createSwissResultReader(stageTwoEdition, stageTwoSchedule.source),
    }),
    source: stageTwoSchedule.source,
    previewSchedule: stageTwoSchedule,
    invitedTeams: stageTwoInvites.teams,
  },
  {
    id: majorPhases[2].id, name: majorPhases[2].name, rosterConfirmed: false,
    // PGL groupStageEndpoint?stage=3, round 5 match 3, schedule checked on November 24.
    lastSeriesAt: Date.parse('2026-12-06T19:00:00+08:00'),
  },
  { id: majorPhases[3].id, name: majorPhases[3].name, rosterConfirmed: false },
];

export function findStage(id, edition) {
  const phase = phases.find(item => item.id === id);
  if (!phase || id !== STAGE_TWO || !edition) return phase;
  const startsAt = Date.parse(edition.startsAt);
  return {
    ...phase, startsAt, closesAt: startsAt - 3600000, rosterConfirmed: true,
    editionVersion: edition.editionVersion ?? edition.version,
    opensNotBefore: edition.opensNotBefore, teams: edition.teams, modelStatus: edition.modelStatus,
    readResults: createSwissResultReader(edition, phase.source),
  };
}

export { stageTwoEdition as packagedStageTwo };

function stageInfo(phase, now, pausedStage, previousSchedule) {
  const previous = phases[phases.findIndex(item => item.id === phase.id) - 1];
  const lastStart = lastSwissSeries(previousSchedule?.games) ?? previous?.lastSeriesAt;
  const opensNotBefore = phase.opensNotBefore ?? (lastStart == null ? null : lastStart + threeHours);
  const { id, name, startsAt, closesAt, rosterConfirmed, source } = phase;
  const ready = rosterConfirmed && Boolean(phase.readResults) &&
    (!previous || (opensNotBefore !== null && now >= opensNotBefore));
  const writesPaused = ready && now < closesAt && id === pausedStage;
  const picksOpen = ready && now < closesAt && !writesPaused;
  const status = !ready ? 'preparing' : writesPaused ? 'paused' : picksOpen ? 'open' : 'locked';
  return { id, name, startsAt, closesAt, opensNotBefore, rosterConfirmed, source, picksOpen, writesPaused, status,
    ...(phase.editionVersion && { editionVersion: phase.editionVersion }) };
}

export async function readStageInfo(phase, now, pausedStage, db) {
  const previous = phases[phases.findIndex(item => item.id === phase.id) - 1];
  const row = previous && db ? await db.prepare('SELECT schedule FROM stage_results WHERE stage=?')
    .bind(previous.id).first() : null;
  return stageInfo(phase, now, pausedStage, row?.schedule && JSON.parse(row.schedule));
}

function displayStatus(info, completed, locks, schedule, now) {
  if (completed) return 'completed';
  const games = schedule?.games ?? [];
  const fresh = schedule?.checked > 0 && now - schedule.checked <= SCHEDULE_FRESH_MS;
  if (fresh && games.some(game => game.status === 'live' && !game.awaitingOfficial)) return 'live';
  if (locks.some(side => side === 0 || side === 1) ||
      games.some(game => game.status === 'live' || game.status === 'end')) return 'in-progress';
  if (info.picksOpen) return 'picks-open';
  if (info.writesPaused) return 'paused';
  if (info.status === 'locked') return 'starting';
  return 'future';
}

export function stageCatalog(now, snapshots = [], pausedStage, edition) {
  let previousSchedule;
  const stages = phases.map((item, i) => {
    const phase = findStage(item.id, edition);
    const info = stageInfo(phase, now, pausedStage, previousSchedule);
    const row = snapshots.find(snapshot => snapshot.stage === phase.id);
    const locks = row ? JSON.parse(row.locks) : [];
    const schedule = row?.schedule ? JSON.parse(row.schedule) : null;
    previousSchedule = schedule;
    const completed = (majorPhases[i].format === 'swiss' && locks.length === 33 &&
      locks.every(side => side === 0 || side === 1)) || Boolean(futureAgendaConfig(phase.id) &&
      schedule?.games?.length && schedule.games.every(game => game.status === 'end'));
    const startDate = info.startsAt ? localStartDay.format(info.startsAt) : majorPhases[i].startDate;
    return { ...info, completed, startDate,
      displayStatus: displayStatus(info, completed, locks, schedule, now) };
  });
  const next = stages.find(stage => !stage.completed) ?? stages.at(-1);
  return { defaultStage: next.id, stages };
}

export async function navigationCatalog(db, now, fetcher, defer, pausedStage, edition) {
  if (!db) return stageCatalog(now, [], pausedStage);
  const { results } = await db.prepare('SELECT stage,locks,schedule,attempted FROM stage_results').bind().all();
  const catalog = stageCatalog(now, results, pausedStage, edition);
  // A visitor on Ranking or Modelos can keep the schedule fresh without delaying navigation.
  if (defer) {
    for (const stage of catalog.stages) {
      if (stage.completed) continue;
      const config = futureAgendaConfig(stage.id);
      if (config && !stage.rosterConfirmed) {
        // Home, ranking or models visitors can keep a running phase's LIVE indicator current.
        const first = config.rows[0];
        const startsAt = Date.parse(first.date.split('.').reverse().join('-') + 'T' + first.time + ':00+08:00');
        const last = config.rows.at(-1);
        const endsAt = Date.parse(last.date.split('.').reverse().join('-') + 'T' + last.time + ':00+08:00');
        if (now >= startsAt - 3600000 && now < endsAt + 86400000)
          defer(readFutureAgenda(stage.id, db, now, fetcher));
        continue;
      }
      if (!stage.rosterConfirmed || now < stage.startsAt) continue;
      const row = results.find(entry => entry.stage === stage.id);
      if (row && now - row.attempted < SCORE_POLL_MS) continue;
      defer(findStage(stage.id, edition).readResults(db, now, fetcher, true));
    }
  }
  return catalog;
}

export function calendarPreview(phase) {
  const { asOf, games, source } = phase.previewSchedule;
  return {
    stage: phase.id,
    preview: true,
    source,
    asOf,
    checked: null,
    scheduleChecked: null,
    stale: true,
    locks: emptyLocks(),
    schedule: games,
  };
}
