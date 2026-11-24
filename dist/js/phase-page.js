import { majorPhases, selectedPhase } from './major-phases.js';
import { phaseAgenda } from './phase-agendas.js';
import { bindParticipation } from './participation.js';

const $ = id => document.getElementById(id);
const url = new URL(location.href);
const path = url.pathname.replace(/\/$/, '') || '/';
const home = path === '/';
const formatTime = ms => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit', hour: '2-digit',
  minute: '2-digit', hourCycle: 'h23',
}).format(ms);

async function start() {
  let catalog;
  try {
    const r = await fetch('/api/stages', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (r.ok) catalog = await r.json();
  } catch { /* The Stage 1 edition and old links also work with the local roster. */ }
  const phase = selectedPhase(url, catalog?.defaultStage);
  const info = catalog?.stages.find(s => s.id === phase.id);
  const first = phase === majorPhases[0];
  const second = phase === majorPhases[1];
  const isComplete = p => catalog?.stages.some(s => s.id === p.id && s.completed);
  for (const nav of document.querySelectorAll('[data-phase-picker]')) {
    const destination = nav.dataset.page || '/';
    for (const p of majorPhases) {
      const tab = document.createElement('a');
      tab.href = destination + '?fase=' + p.key;
      tab.textContent = p.name;
      if (phase === p) tab.setAttribute('aria-current', 'page');
      nav.append(tab);
    }
  }
  // A document change discards workers and outstanding requests belonging to the old phase.
  if (!first || url.searchParams.has('fase') || catalog?.defaultStage !== majorPhases[0].id) {
    for (const a of document.querySelectorAll('header a')) {
      if (['/', '/modelos', '/partidas'].includes(a.pathname)) a.search = '?fase=' + phase.key;
    }
  }
  bindParticipation(phase.id);
  const agendas = $('phaseAgendas');
  if (first) {
    agendas.append(phaseAgenda(majorPhases[1]));
    document.addEventListener('stage-one-completed', () => {
      const current = document.querySelector('section.agenda');
      const history = document.createElement('details');
      history.className = 'panel phase-agenda';
      const title = document.createElement('summary');
      title.textContent = 'Agenda do Stage 1 · Histórico';
      history.open = current.contains(document.activeElement);
      current.removeAttribute('data-page');
      current.hidden = false;
      history.append(title, current);
      agendas.replaceChildren(phaseAgenda(majorPhases[1], { expanded: true }), history);
    }, { once: true });
    const { startSwissEdition } = await import('./app.js');
    await startSwissEdition(phase);
  } else {
    for (const section of document.querySelectorAll('[data-page]')) {
      section.hidden = true;
    }
    const picker = document.querySelector('[data-phase-picker][data-page="' + path + '"]');
    if (picker) picker.hidden = false;
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
      $('phaseEvent').textContent = phase.teams + ' equipes · ' +
        (info?.startsAt ? 'Início previsto em ' + formatTime(info.startsAt) + ' (UTC−4)' : 'Fase futura');
      title.textContent = (swiss ? 'Cartão do ' : 'Chave dos ') + phase.name;
      text.textContent = second
        ? 'Oito convidados aguardam os oito classificados do Stage 1. Os picks e a simulação abrem com as equipes e os confrontos confirmados.'
        : swiss ? 'Os dez picks e a simulação estarão disponíveis quando as equipes forem confirmadas.'
          : 'Você escolherá os vencedores das quatro quartas de final, das duas semifinais e da final.';
      if (info?.closesAt) text.append(' Prazo previsto para salvar: ' + formatTime(info.closesAt) + ' (UTC−4).');
      $('participation').hidden = false;
      agendas.hidden = false;
    } else if (path === '/modelos') {
      picker.after(panel);
      title.textContent = 'Modelos · ' + phase.name;
      text.textContent = swiss
        ? 'As previsões e os ajustes pessoais desta fase abrem com o elenco confirmado. O Modelo IA terá um estudo próprio.'
        : 'O estudo dos playoffs estimará a chance de avançar nas quartas, nas semifinais e de ganhar o título.';
    } else if (path === '/partidas') {
      const games = $('jogos');
      games.hidden = false;
      games.querySelector('.bracket-panel').hidden = true;
      games.querySelector('.kicker').textContent = phase.name.toUpperCase() + (swiss ? ' · SISTEMA SUÍÇO' : ' · ELIMINAÇÃO SIMPLES');
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
