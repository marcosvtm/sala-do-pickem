import { selectedPhase } from './major-phases.js';
import { readStageCatalog } from './phase-picker.js';

const $ = id => document.getElementById(id);
const url = new URL(location.href);
const path = url.pathname.replace(/\/$/, '') || '/';
const home = path === '/';

async function start() {
  const catalog = await readStageCatalog();
  const phase = selectedPhase(url, catalog?.defaultStage);
  if (home && ['#jogos', '#modelos'].includes(url.hash)) {
    location.replace((url.hash === '#jogos' ? '/partidas' : '/modelos') + url.search);
    return;
  }
  if (home) {
    const { bindHomePhases } = await import('./home-phases.js');
    bindHomePhases(phase, catalog);
    return;
  }
  const { bindSwissSection } = await import('./section-phases.js');
  bindSwissSection(phase, catalog);
}

start().catch(() => {
  $('phasePreview').hidden = false;
  $('phasePreviewTitle').textContent = 'Não foi possível carregar a fase.';
  $('phasePreviewText').textContent = 'Recarregue a página para tentar novamente.';
}).finally(() => { $('majorMain').hidden = false; });
