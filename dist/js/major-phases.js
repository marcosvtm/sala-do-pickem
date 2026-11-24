export const majorPhases = [
  { key: 'stage-1', id: 'sg26-s1-v1', name: 'Stage 1', teams: 16, format: 'swiss',
    rosterUrl: '/data/stage.json', scheduleUrl: '/data/schedule.json' },
  { key: 'stage-2', id: 'sg26-s2-v1', name: 'Stage 2', teams: 16, format: 'swiss' },
  { key: 'stage-3', id: 'sg26-s3-v1', name: 'Stage 3', teams: 16, format: 'swiss' },
  { key: 'playoffs', id: 'sg26-playoffs', name: 'Playoffs', teams: 8, format: 'bracket' },
];

export function phasePath(path, stageId) {
  const phase = majorPhases.find(p => p.id === stageId);
  if (!phase) throw Error('Fase desconhecida');
  const url = new URL(path, 'https://pickem.invalid');
  if (url.pathname.startsWith('/api/')) url.searchParams.set('stage', phase.id);
  else url.searchParams.set('fase', phase.key);
  return url.pathname + url.search + url.hash;
}

export function selectedPhase(url, defaultId) {
  const key = url.searchParams.get('fase');
  const explicit = majorPhases.find(phase => phase.key === key);
  if (explicit) return explicit;
  if (['editar', 'simular', 'modelo'].some(param => url.searchParams.has(param)) ||
      url.hash.startsWith('#c=')) return majorPhases[0];
  return majorPhases.find(phase => phase.id === defaultId) || majorPhases[0];
}
