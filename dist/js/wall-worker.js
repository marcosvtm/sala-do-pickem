import { sampleRun, exactRun } from './simulation.js';
import { refreshEditionStudy } from './models.js';
function probability(teams, state) {
  const exact = state.locks.filter((x) => x === -1).length <= 9;
  const run = exact
    ? exactRun(teams, state)
    : sampleRun(teams, state, [state.model]);
  const n = exact ? run.total : 12000;
  for (let i = 0; i < n; i++) run.next();
  return run
    .snapshot()
    .histograms[state.model].slice(5)
    .reduce((a, b) => a + b, 0);
}
onmessage = async ({ data: { key, teams, settings, locks, edition } }) => {
  try {
    await refreshEditionStudy(edition);
    postMessage({ key, value: probability(teams, { ...settings, locks }) });
  } catch {
    postMessage({ key, value: null });
  }
};
