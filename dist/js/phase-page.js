import { majorPhases, selectedPhase } from './major-phases.js';
import { phaseAgenda } from './phase-agendas.js';
import { bindPhasePickers, readStageCatalog } from './phase-picker.js';

const $ = id => document.getElementById(id);
const url = new URL(location.href);
const path = url.pathname.replace(/\/$/, '') || '/';
const home = path === '/';
const formatTime = ms => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit', hour: '2-digit',
  minute: '2-digit', hourCycle: 'h23',
}).format(ms);

async function start() {
  const catalog = await readStageCatalog();
  const phase = selectedPhase(url, catalog?.defaultStage);
  const info = catalog?.stages.find(s => s.id === phase.id);
  const first = phase === majorPhases[0];
  const second = phase === majorPhases[1];
  const isComplete = p => catalog?.stages.some(s => s.id === p.id && s.completed);
  bindPhasePickers(phase, catalog);
  $('modelsPhaseLabel').textContent = phase.name + ' · Singapura';
  $('matchesPhaseLabel').textContent = phase.name + (phase.format === 'swiss' ? ' · Sistema suíço' : ' · Eliminação simples');
  // A document change discards workers and outstanding requests belonging to the old phase.
  if (!first || url.searchParams.has('fase') || catalog?.defaultStage !== majorPhases[0].id) {
    for (const a of document.querySelectorAll('header a')) {
      if (['/', '/modelos', '/partidas'].includes(a.pathname)) a.search = '?fase=' + phase.key;
    }
  }
  const agendas = $('phaseAgendas');
  if (first || (phase.format === 'swiss' && phase.rosterUrl && info?.rosterConfirmed && info.status !== 'preparing')) {
    const index = majorPhases.indexOf(phase);
    const next = majorPhases[index + 1];
    const current = document.querySelector('section.agenda');
    current.querySelector('h2').textContent = 'Agenda do ' + phase.name;
    const eventLink = current.querySelector('.hltv-event');
    if (second) eventLink.href = 'https://www.hltv.org/events/9304/matches';
    eventLink.setAttribute('aria-label', 'Agenda do ' + phase.name + ' na HLTV (abre em nova aba)');
    eventLink.title = eventLink.getAttribute('aria-label');
    $('jogos').after(current, agendas);
    const previousPanels = majorPhases.slice(0, index).reverse().map(previous =>
      phaseAgenda(previous, { completed: isComplete(previous) }));
    if (next) agendas.append(phaseAgenda(next));
    agendas.append(...previousPanels);
    if (next) document.addEventListener('swiss-stage-completed', () => {
      const history = document.createElement('details');
      history.className = 'panel phase-agenda';
      const title = document.createElement('summary');
      title.textContent = 'Agenda do ' + phase.name + ' · Histórico';
      history.open = current.contains(document.activeElement);
      current.removeAttribute('data-page');
      current.hidden = false;
      history.append(title, current);
      agendas.replaceChildren(phaseAgenda(next, { expanded: true }), history, ...previousPanels);
    }, { once: true });
    const { startSwissEdition } = await import('./app.js');
    await startSwissEdition(phase);
  } else {
    for (const section of document.querySelectorAll('[data-page]')) {
      section.hidden = true;
    }
    document.title = (home ? "Pick'em dos Broxinhas" : path === '/modelos' ? 'Modelos' : 'Partidas') +
      ' · ' + phase.name;
    for (const a of document.querySelectorAll('header a'))
      if (a.pathname === path) a.setAttribute('aria-current', 'page');
    const panel = $('phasePreview');
    panel.hidden = false;
    const title = $('phasePreviewTitle'), text = $('phasePreviewText');
    const swiss = phase.format === 'swiss';
    if (home) {
      const hero = document.querySelector('.hero-home');
      hero.hidden = false;
      hero.querySelector('.deadline').hidden = true;
      title.textContent = (swiss ? 'Cartão do ' : 'Chave dos ') + phase.name;
      text.textContent = second
        ? 'Oito convidados aguardam os oito classificados do Stage 1. Os picks e a simulação abrem com as equipes e os confrontos confirmados.'
        : swiss ? 'Os dez picks e a simulação estarão disponíveis quando as equipes forem confirmadas.'
          : 'Você escolherá os vencedores das quatro quartas de final, das duas semifinais e da final.';
      if (info?.closesAt) text.append(' Prazo previsto para salvar: ' + formatTime(info.closesAt) + ' (UTC−4).');
      agendas.hidden = false;
    } else if (path === '/modelos') {
      const heading = document.querySelector('.models-heading');
      heading.hidden = false;
      heading.after(panel);
      title.textContent = 'Previsões em preparação';
      text.textContent = swiss
        ? 'As previsões e os ajustes pessoais desta fase abrem com o elenco confirmado. O Modelo IA terá um estudo próprio.'
        : 'O estudo dos playoffs estimará a chance de avançar nas quartas, nas semifinais e de ganhar o título.';
    } else if (path === '/partidas') {
      const games = $('jogos');
      games.hidden = false;
      games.querySelector('.bracket-panel').hidden = true;
      games.after(panel);
      panel.after(agendas);
      agendas.hidden = false;
      title.textContent = 'Chaveamento em preparação';
      text.textContent = swiss ? 'O chaveamento abre com os pareamentos oficiais da primeira rodada.'
        : 'A chave acompanhará as quartas, as semifinais e a final.';
    }
    if (!agendas.hidden) {
      agendas.append(phaseAgenda(phase, { expanded: true }));
      for (const previous of majorPhases.slice(0, majorPhases.indexOf(phase)).reverse()) {
        agendas.append(phaseAgenda(previous, { completed: isComplete(previous) }));
      }
    }
    if (home && second) {
      try {
        $('majorMain').hidden = false;
        const r = await fetch('/api/stage?stage=' + phase.id, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const detail = await r.json();
          if (detail.invitedTeams?.length) {
            $('phaseInvites').textContent = 'Convidados: ' + detail.invitedTeams.map(t => t.name).join(' · ');
            $('phaseInvites').hidden = false;
          }
        }
      } catch { /* The published schedule is available separately. */ }
    }
  }
}

start().catch(() => {
  $('phasePreview').hidden = false;
  $('phasePreviewTitle').textContent = 'Não foi possível carregar a fase.';
  $('phasePreviewText').textContent = 'Recarregue a página para tentar novamente.';
}).finally(() => { $('majorMain').hidden = false; });
