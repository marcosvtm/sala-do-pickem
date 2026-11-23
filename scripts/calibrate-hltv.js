import { readFileSync } from 'node:fs';
import { hltvWinChance } from '../dist/js/models.js';

const csv = readFileSync(
  new URL('../research/hltv-series.csv', import.meta.url),
  'utf8'
);
const samples = csv
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((line) => {
    const [week, , , bo, a, b, win] = line.split(',');
    return {
      week,
      bo: Number(bo),
      a: Number(a),
      b: Number(b),
      win: Number(win),
    };
  });
const train = samples.filter((r) => r.week < '2026-10-01');
const holdout = samples.filter((r) => r.week >= '2026-10-01');

function metrics(rows, slope) {
  let squaredError = 0,
    logLoss = 0;
  for (const { a, b, bo, win } of rows) {
    const p = hltvWinChance(a, b, bo, slope);
    squaredError += (p - win) ** 2;
    logLoss -= Math.log(win ? p : 1 - p);
  }
  return {
    series: rows.length,
    brier: squaredError / rows.length,
    logLoss: logLoss / rows.length,
  };
}

// Minimize training log loss on a single nonnegative slope. Later series are held out.
let lower = 0,
  upper = 4;
for (let i = 0; i < 64; i++) {
  const left = (2 * lower + upper) / 3,
    right = (lower + 2 * upper) / 3;
  if (metrics(train, left).logLoss < metrics(train, right).logLoss)
    upper = right;
  else lower = left;
}
const slope = Number(((lower + upper) / 2).toFixed(6));
console.log({
  slope,
  train: metrics(train, slope),
  holdout: metrics(holdout, slope),
  neutralHoldout: metrics(holdout, 0),
});
