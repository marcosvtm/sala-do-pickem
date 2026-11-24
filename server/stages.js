import stageOne from '../dist/data/stage.json' with { type: 'json' };
import stageTwoInvites from '../dist/data/stage2-invites.json' with { type: 'json' };
import stageTwoSchedule from '../dist/data/stage2-schedule.json' with { type: 'json' };
import { CLOSE, SOURCE, START, emptyLocks, liveResults } from './results.js';

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

export function stageCatalog(now) {
  return { defaultStage: LEGACY_STAGE_ID, stages: phases.map((phase) => stageInfo(phase, now)) };
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
