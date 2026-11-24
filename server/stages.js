import stageOne from '../dist/data/stage.json' with { type: 'json' };
import stageTwoInvites from '../dist/data/stage2-invites.json' with { type: 'json' };
import stageTwoSchedule from '../dist/data/stage2-schedule.json' with { type: 'json' };
import { CLOSE, SOURCE, START, emptyLocks, liveResults } from './results.js';
import { majorPhases } from '../dist/js/major-phases.js';

// Unscoped links and requests from the first release always refer to this roster.
export const LEGACY_STAGE_ID = stageOne.id;
const stageTwoStart = Math.min(...stageTwoSchedule.games.map((game) => game.at));
const phases = [
  {
    id: LEGACY_STAGE_ID,
    name: 'Stage 1',
    startsAt: START,
    closesAt: CLOSE,
    rosterConfirmed: true,
    source: SOURCE,
    readResults: liveResults,
  },
  {
    id: 'sg26-s2-v1',
    name: 'Stage 2',
    startsAt: stageTwoStart,
    closesAt: stageTwoStart - 60 * 60 * 1000,
    rosterConfirmed: false,
    source: stageTwoSchedule.source,
    previewSchedule: stageTwoSchedule,
    invitedTeams: stageTwoInvites.teams,
  },
  ...majorPhases.slice(2).map(({ id, name }) => ({ id, name, rosterConfirmed: false })),
];

export function findStage(id) {
  return phases.find((phase) => phase.id === id);
}

export function stageInfo(phase, now) {
  const { id, name, startsAt, closesAt, rosterConfirmed, source } = phase;
  const ready = rosterConfirmed && Boolean(phase.readResults);
  const picksOpen = ready && now < closesAt;
  const status = ready ? (picksOpen ? 'open' : 'locked') : 'preparing';
  return { id, name, startsAt, closesAt, rosterConfirmed, source, picksOpen, status };
}

export function stageCatalog(now, completed = []) {
  const stages = phases.map(phase => ({
    ...stageInfo(phase, now), completed: completed.includes(phase.id),
  }));
  const next = stages.find(stage => !stage.completed) ?? stages.at(-1);
  return { defaultStage: next.id, stages };
}

export async function navigationCatalog(db, now) {
  if (!db) return stageCatalog(now);
  const { results } = await db.prepare('SELECT stage,locks FROM stage_results').bind().all();
  const completed = results.filter(row => {
    const locks = JSON.parse(row.locks);
    return Array.isArray(locks) && locks.length === 33 &&
      locks.every(side => side === 0 || side === 1);
  }).map(row => row.stage);
  return stageCatalog(now, completed);
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
