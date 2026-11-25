import stageOneSchedule from '../dist/data/schedule.json' with { type: 'json' };
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import stageTwoInvites from '../dist/data/stage2-invites.json' with { type: 'json' };
import stageTwoSchedule from '../dist/data/stage2-schedule.json' with { type: 'json' };
import stageTwoEdition from '../dist/data/edition-s2.json' with { type: 'json' };
import { CLOSE, SOURCE, START, emptyLocks, liveResults, createSwissResultReader } from './results.js';
import { majorPhases } from '../dist/js/major-phases.js';
import { SCORE_POLL_MS, SCHEDULE_FRESH_MS } from '../dist/js/schedule.js';

// Unscoped links and requests from the first release always refer to this roster.
export const LEGACY_STAGE_ID = stageOne.id;
const localStartDay = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit',
});
const stageTwoStart = stageTwoEdition ? Date.parse(stageTwoEdition.startsAt)
  : Math.min(...stageTwoSchedule.games.map((game) => game.at));
const estimatedMd3DurationMs = 3 * 60 * 60 * 1000;

function lastSwissSeries(games) {
  const finals = games?.filter(game => game.round === 5 && game.bo === 3 && Number.isFinite(game.at));
  return finals?.length === 3 ? Math.max(...finals.map(game => game.at)) : null;
}

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
    id: 'sg26-s2-v1',
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

export function findStage(id) {
  return phases.find((phase) => phase.id === id);
}

function stageInfo(phase, now, pausedStage, previousSchedule) {
  const previous = phases[phases.indexOf(phase) - 1];
  const lastStart = lastSwissSeries(previousSchedule?.games) ?? previous?.lastSeriesAt;
  const opensNotBefore = lastStart == null ? null : lastStart + estimatedMd3DurationMs;
  const { id, name, startsAt, closesAt, rosterConfirmed, source } = phase;
  const ready = rosterConfirmed && Boolean(phase.readResults) &&
    (!previous || (opensNotBefore !== null && now >= opensNotBefore));
  const writesPaused = ready && now < closesAt && id === pausedStage;
  const picksOpen = ready && now < closesAt && !writesPaused;
  const status = !ready ? 'preparing' : writesPaused ? 'paused' : picksOpen ? 'open' : 'locked';
  return { id, name, startsAt, closesAt, opensNotBefore, rosterConfirmed, source, picksOpen, writesPaused, status };
}

export async function readStageInfo(phase, now, pausedStage, db) {
  const previous = phases[phases.indexOf(phase) - 1];
  const row = previous && db ? await db.prepare('SELECT schedule FROM stage_results WHERE stage=?')
    .bind(previous.id).first() : null;
  return stageInfo(phase, now, pausedStage, row?.schedule && JSON.parse(row.schedule));
}

function displayStatus(info, completed, locks, schedule, now) {
  if (completed) return 'completed';
  const games = schedule?.games ?? [];
  const fresh = schedule?.checked > 0 && now - schedule.checked <= SCHEDULE_FRESH_MS;
  if (fresh && games.some(game => game.status === 'live')) return 'live';
  if (locks.some(side => side === 0 || side === 1) ||
      games.some(game => game.status === 'live' || game.status === 'end')) return 'in-progress';
  if (info.picksOpen) return 'picks-open';
  if (info.writesPaused) return 'paused';
  if (info.status === 'locked') return 'starting';
  return 'future';
}

export function stageCatalog(now, snapshots = [], pausedStage) {
  let previousSchedule;
  const stages = phases.map((phase, i) => {
    const info = stageInfo(phase, now, pausedStage, previousSchedule);
    const row = snapshots.find(snapshot => snapshot.stage === phase.id);
    const locks = row ? JSON.parse(row.locks) : [];
    const schedule = row?.schedule ? JSON.parse(row.schedule) : null;
    previousSchedule = schedule;
    const completed = majorPhases[i].format === 'swiss' && locks.length === 33 &&
      locks.every(side => side === 0 || side === 1);
    const startDate = info.startsAt ? localStartDay.format(info.startsAt) : majorPhases[i].startDate;
    return { ...info, completed, startDate,
      displayStatus: displayStatus(info, completed, locks, schedule, now) };
  });
  const next = stages.find(stage => !stage.completed) ?? stages.at(-1);
  return { defaultStage: next.id, stages };
}

export async function navigationCatalog(db, now, fetcher, defer, pausedStage) {
  if (!db) return stageCatalog(now, [], pausedStage);
  const { results } = await db.prepare('SELECT stage,locks,schedule,attempted FROM stage_results').bind().all();
  const catalog = stageCatalog(now, results, pausedStage);
  // A visitor on Ranking or Modelos can keep the schedule fresh without delaying navigation.
  if (defer) {
    for (const stage of catalog.stages) {
      if (stage.completed || !stage.rosterConfirmed || now < stage.startsAt) continue;
      const row = results.find(entry => entry.stage === stage.id);
      if (row && now - row.attempted < SCORE_POLL_MS) continue;
      defer(findStage(stage.id).readResults(db, now, fetcher, true));
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
