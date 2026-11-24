import { majorPhases } from './major-phases.js';

const labels = {
  'picks-open': 'Picks abertos',
  paused: 'Pausado',
  starting: 'A iniciar',
  live: 'LIVE',
  'in-progress': 'Em curso',
  completed: 'Encerrado',
};

export async function readStageCatalog() {
  try {
    const response = await fetch('/api/stages', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const result = await response.json();
      if (Array.isArray(result.stages)) return result;
    }
  } catch { /* Shared links still work when the catalog is temporarily unavailable. */ }
  return null;
}

export function bindPhasePickers(selected, initialCatalog, pickers = document.querySelectorAll('.phase-picker')) {
  const tabs = [];
  for (const nav of pickers) {
    const path = nav.dataset.destination;
    if (path === '/ranking') {
      const general = document.createElement('a');
      general.href = path;
      general.textContent = 'Geral';
      general.className = 'all-phases';
      if (!selected) general.setAttribute('aria-current', 'page');
      nav.append(general);
    }
    for (const phase of majorPhases) {
      const tab = document.createElement('a');
      tab.href = path + '?fase=' + phase.key;
      const name = document.createElement('span');
      name.textContent = phase.name;
      const badge = document.createElement('small');
      badge.className = 'phase-status';
      tab.append(name, badge);
      if (phase === selected) tab.setAttribute('aria-current', 'page');
      nav.append(tab);
      tabs.push({ tab, badge, phase });
    }
  }

  let catalog = initialCatalog;
  let lastSuccess = catalog ? Date.now() : 0;
  let busy = false;
  function render(fresh) {
    for (const { tab, badge, phase } of tabs) {
      const stage = catalog?.stages.find(item => item.id === phase.id);
      let state = stage?.displayStatus;
      if (!fresh && state === 'live') state = 'in-progress';
      if (!fresh && state === 'picks-open') state = undefined;
      const label = state === 'future' ? stage.startDate || 'A definir' : labels[state] || 'Sem dados';
      const calendar = state === 'future' && Boolean(stage.startDate);
      badge.dataset.state = calendar ? 'date' : state || 'unknown';
      badge.textContent = label;
      const spoken = calendar ? 'Início previsto em ' + label : state === 'live' ? 'Partida ao vivo' : label;
      tab.setAttribute('aria-label', phase.name + ', ' + spoken);
      tab.title = phase.name + ' · ' + spoken;
    }
  }
  async function refresh() {
    if (document.hidden || busy) return;
    if (Date.now() - lastSuccess >= 30000) render(false);
    busy = true;
    try {
      const updated = await readStageCatalog();
      if (updated) {
        catalog = updated;
        lastSuccess = Date.now();
        const info = updated.stages.find(stage => stage.id === selected?.id);
        if (info) document.dispatchEvent(new CustomEvent('phase-card-writes', { detail: info }));
      }
      render(Boolean(updated));
    } finally {
      busy = false;
    }
  }
  render(Boolean(catalog));
  setInterval(refresh, 15000);
  document.addEventListener('visibilitychange', refresh);
  return {
    select(phase) {
      selected = phase;
      for (const item of tabs) {
        if (item.phase === phase) item.tab.setAttribute('aria-current', 'page');
        else item.tab.removeAttribute('aria-current');
      }
    },
    info: phase => catalog?.stages.find(stage => stage.id === phase.id),
  };
}
