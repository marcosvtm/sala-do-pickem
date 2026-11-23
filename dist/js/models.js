export const MODELS = {
  neutral: 'Neutro 50/50',
  vrs: 'Ranking Valve',
  hltv: 'Ranking HLTV',
  elo: 'Forma recente',
  custom: 'Modelo personalizado',
};
export const modelName = (id, nick) =>
  id === 'custom' && nick ? 'Modelo ' + nick : MODELS[id];
export const BASE_MODELS = ['vrs', 'hltv', 'elo'];
export function describeBase(settings) {
  return settings.base
    ? MODELS[settings.base] + ' com peso de ' + settings.weight + '%'
    : 'Fórmula anterior · forma recente com peso de ' + settings.form + '%';
}
export const explanations = {
  neutral: 'Cada equipe tem 50% de chance em qualquer confronto.',
  vrs: 'Usa a diferença de pontos no ranking da Valve. Uma vantagem pesa mais em MD3 do que em MD1.',
  hltv: 'Compara as posições no ranking mundial da HLTV. Posições próximas dão chances próximas de 50%. A vantagem do favorito cresce em MD3.',
  elo: 'Usa o Elo calculado antes do Major. Considera os adversários, com meia-vida de 160 dias.',
  custom:
    'Escolha uma base e defina quanto ela pesa em relação a um confronto 50/50.',
};
const logistic = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

// Fitted on pre-October 2026 series. See scripts/calibrate-hltv.js.
export function hltvWinChance(rankA, rankB, bo, slope = 0.306262) {
  const mapChance = logistic(slope * Math.log(rankB / rankA));
  return bo === 1 ? mapChance : mapChance ** 2 * (3 - 2 * mapChance);
}

export function makeMatrix(teams, model, config) {
  if (model === 'custom' && config.base) {
    const field = { vrs: 'vrs', elo: 'elo', hltv: 'hltvRank' }[config.base];
    const ranked = config.base === 'hltv';
    const signals = teams.map((t) => (ranked ? Math.log(t[field]) : t[field]));
    const meanSignal =
      signals.reduce((total, x) => total + x, 0) / teams.length;
    const adjusted = teams.map((team, i) => {
      if (config.trust[i] === 100) return team;
      const signal =
        meanSignal + ((signals[i] - meanSignal) * config.trust[i]) / 100;
      return { ...team, [field]: ranked ? Math.exp(signal) : signal };
    });
    const matrix = makeMatrix(adjusted, config.base, config);
    const weight = config.weight / 100;
    const offsets = config.bonus.map((points) => logit(0.5 + points / 100));
    for (const bo of [1, 3]) {
      matrix[bo] = matrix[bo].map((row, a) =>
        row.map((p, b) => {
          const difference = offsets[a] - offsets[b];
          const adjustedChance =
            difference === 0 ? p : logistic(logit(p) + difference);
          return weight === 1
            ? adjustedChance
            : 0.5 + weight * (adjustedChance - 0.5);
        })
      );
    }
    return matrix;
  }
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

export function fieldStrength(matrix) {
  return matrix.map(
    (row, i) =>
      row.reduce((sum, p, j) => sum + (i === j ? 0 : p), 0) / (row.length - 1)
  );
}
