export const MODELS = {
  neutral: 'Neutro 50/50',
  vrs: 'Ranking Valve',
  hltv: 'Ranking HLTV',
  elo: 'Forma recente',
  custom: 'Modelo personalizado',
};
export const modelName = (id, nick) =>
  id === 'custom' && nick ? 'Modelo ' + nick : MODELS[id];
export const explanations = {
  neutral: 'Cada equipe tem 50% de chance em qualquer confronto.',
  vrs: 'Usa a diferença de pontos no ranking da Valve. Uma vantagem pesa mais em MD3 do que em MD1.',
  hltv: 'Compara as posições no ranking mundial da HLTV. Posições próximas dão chances próximas de 50%. A vantagem do favorito cresce em MD3.',
  elo: 'Usa o Elo calculado antes do Major. Considera os adversários, com meia-vida de 160 dias.',
  custom:
    'Combine ranking e forma recente. Ajuste a confiança no histórico e o desempenho esperado de cada equipe.',
};
const logistic = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

// Fitted on pre-October 2026 series. See scripts/calibrate-hltv.js.
export function hltvWinChance(rankA, rankB, bo, slope = 0.306262) {
  const mapChance = logistic(slope * Math.log(rankB / rankA));
  return bo === 1 ? mapChance : mapChance ** 2 * (3 - 2 * mapChance);
}

export function makeMatrix(teams, model, config) {
  const mean = (key) =>
    teams.reduce((sum, t) => sum + t[key], 0) / teams.length;
  const meanVrs = mean('vrs'),
    meanElo = mean('elo');
  const matrix = {};
  for (const bo of [1, 3]) {
    if (model === 'hltv') {
      matrix[bo] = teams.map((a) =>
        teams.map((b) => hltvWinChance(a.hltvRank, b.hltvRank, bo))
      );
      continue;
    }
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
