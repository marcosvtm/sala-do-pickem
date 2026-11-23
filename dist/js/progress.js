import { availableGames } from './swiss.js';

export function progress(locks) {
  const teams = Array.from({ length: 16 }, () => ({ wins: 0, losses: 0 }));
  const finished = [];
  for (const round of availableGames(locks))
    for (const game of round) {
      const side = locks[game.match];
      if (side === -1) continue;
      const winner = side === 0 ? game.a : game.b;
      teams[winner].wins++;
      teams[side === 0 ? game.b : game.a].losses++;
      finished.push({ ...game, winner });
    }
  return { teams, finished };
}
export function pickStatus(slot, { wins, losses }) {
  if (slot < 2) return losses > 0 ? 'miss' : wins === 3 ? 'hit' : 'open';
  if (slot >= 8) return wins > 0 ? 'miss' : losses === 3 ? 'hit' : 'open';
  if (losses === 3 || (wins === 3 && losses === 0)) return 'miss';
  return wins === 3 ? 'hit' : 'open';
}
export function fixtureBrier(matrix, finished) {
  if (!finished.length) return null;
  return (
    finished.reduce(
      (sum, g) =>
        sum + (matrix[g.bo][g.a][g.b] - Number(g.a === g.winner)) ** 2,
      0
    ) / finished.length
  );
}
