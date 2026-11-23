import { sampleRun, exactRun } from './simulation.js';
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
onmessage = ({ data: { cards, teams, locks } }) => {
  const live = locks.some((x) => x !== -1);
  for (const { id, settings } of cards) {
    const initial = probability(teams, settings);
    const current = live ? probability(teams, { ...settings, locks }) : initial;
    postMessage({ id, initial, current });
  }
};
