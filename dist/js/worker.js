import { sampleRun, exactRun } from './simulation.js';

let job, timer;
function tick() {
  const start = performance.now();
  let done;
  do {
    job.run.next();
    job.count++;
    done = job.count >= job.limit || performance.now() >= job.deadline;
  } while (!done && performance.now() - start < 65);
  if (done || performance.now() - job.last > 200) {
    postMessage({ ...job.run.snapshot(), done });
    job.last = performance.now();
  }
  if (!done) timer = setTimeout(tick, 0);
}
onmessage = ({ data }) => {
  clearTimeout(timer);
  if (data.stop) {
    if (job?.count)
      postMessage({ ...job.run.snapshot(), done: true, stopped: true });
    return;
  }
  const { teams, state, mode, seconds } = data;
  const exact = mode === 'exact';
  const run = exact ? exactRun(teams, state) : sampleRun(teams, state);
  const limit = exact ? run.total : mode === 'preview' ? 12000 : Infinity;
  job = {
    run,
    limit,
    count: 0,
    last: 0,
    deadline: mode === 'timed' ? performance.now() + seconds * 1000 : Infinity,
  };
  tick();
};
