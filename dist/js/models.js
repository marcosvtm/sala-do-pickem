export const MODELS = {
  neutral: 'Neutro 50/50',
  vrs: 'Ranking Valve',
  elo: 'Forma recente',
  custom: 'Modelo do grupo',
};
const logistic = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

export function makeMatrix(teams, model, config) {
  const mean = (key) =>
    teams.reduce((sum, t) => sum + t[key], 0) / teams.length;
  const meanVrs = mean('vrs'),
    meanElo = mean('elo');
  const matrix = {};
  for (const bo of [1, 3]) {
    const strength = teams.map((team, i) => {
      const rank = (team.vrs - meanVrs) / (bo === 1 ? 340 : 255);
      const form = ((team.elo - meanElo) / 170) * (bo === 1 ? 0.73 : 1);
      if (model === 'neutral') return 0;
      if (model === 'vrs') return rank;
      if (model === 'elo') return form;
      const weight = ((config.form / 100) * config.trust[i]) / 100;
      return (
        rank * (1 - weight) + form * weight + logit(0.5 + config.bonus[i] / 100)
      );
    });
    matrix[bo] = strength.map((a) => strength.map((b) => logistic(a - b)));
  }
  return matrix;
}
