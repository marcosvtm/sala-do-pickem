import { createSearch, QUICK_STARTS } from './suggestion-search.js';

let search,
  deadline,
  stopped = false,
  running = false,
  quick,
  began,
  lastUpdate;
function tick() {
  if (!running) return;
  const progress = search.progress();
  const finished =
    search.fixed ||
    stopped ||
    (quick ? progress.starts >= QUICK_STARTS : performance.now() >= deadline);
  if (finished) {
    running = false;
    postMessage({ type: 'result', ...search.result() });
    return;
  }
  if (performance.now() - lastUpdate >= 750) {
    lastUpdate = performance.now();
    postMessage({
      type: 'progress',
      ...progress,
      elapsed: (lastUpdate - began) / 1000,
    });
  }
  search.step();
  setTimeout(tick, 0);
}

onmessage = ({ data }) => {
  if (data.type === 'stop') {
    stopped = true;
    return;
  }
  if (running) return;
  quick = data.type === 'open';
  if (quick) search = createSearch(data.teams, data.state);
  if (!search) return;
  began = performance.now();
  lastUpdate = -Infinity;
  deadline = data.seconds ? began + 1000 * data.seconds : Infinity;
  stopped = false;
  running = true;
  tick();
};
