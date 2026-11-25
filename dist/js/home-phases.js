import { majorPhases, phasePath, selectedPhase } from './major-phases.js';
import { phaseAgenda } from './phase-agendas.js';
import { bindPhasePickers } from './phase-picker.js';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function preparing(phase, template, deadlineTemplate) {
  const dashboard = template.content.firstElementChild.cloneNode(true);
  const playoffs = phase.format === 'bracket';
  const second = phase.key === 'stage-2';
  dashboard.querySelector('[data-card-title]').textContent = (playoffs ? 'Chave dos ' : 'Cartão do ') + phase.name;
  dashboard.querySelector('[data-card-status]').textContent = second
    ? 'Oito convidados aguardam os oito classificados do Stage 1 para a abertura dos picks.'
    : playoffs ? 'Você poderá escolher os vencedores das quartas de final, das semifinais e da final quando a chave estiver definida.'
      : 'Os picks abrem quando as equipes e os confrontos da primeira rodada estiverem confirmados.';
  dashboard.querySelector('[data-simulation-title]').textContent = playoffs ? 'Simulação dos Playoffs' : 'Chance de passar';
  dashboard.querySelector('[data-model-status]').textContent = playoffs
    ? 'Os modelos dos playoffs estarão disponíveis quando a chave estiver definida.'
    : 'A simulação aguarda as equipes e os modelos do ' + phase.name + '.';
  const deadline = deadlineTemplate.cloneNode(true);
  deadline.querySelector('#countdown').hidden = true;
  deadline.querySelector('[data-waiting-clock]').removeAttribute('hidden');
  const time = deadline.querySelector('small');
  function updateDeadline(info, now) {
    const at = info?.opensNotBefore;
    const text = !at ? 'Abertura a confirmar' : now < at
      ? 'Previsto para ' + dateTime.format(at) + ' (UTC-4)'
      : 'Aguardando confirmação da fase';
    if (time.textContent !== text) time.textContent = text;
    deadline.title = 'Os picks abrem após a confirmação das equipes e dos confrontos' +
      (at ? ', a partir de ' + dateTime.format(at) + ' (UTC-4).' : '.');
  }
  if (second) {
    fetch(phasePath('/api/stage', phase.id), { signal: AbortSignal.timeout(5000) })
      .then(response => response.ok ? response.json() : null)
      .then(detail => {
        if (!detail?.invitedTeams?.length) return;
        const invites = dashboard.querySelector('[data-invites]');
        invites.textContent = 'Convidados: ' + detail.invitedTeams.map(team => team.name).join(' · ');
        invites.hidden = false;
      }).catch(() => {});
  }
  return { dashboard, deadline, ready: false, updateDeadline };
}

// Each Swiss edition owns its controls and callbacks, even when a different phase is visible.
function swissView(phase, templates, entry, active) {
  const nodes = Object.fromEntries(Object.entries(templates).map(([key, el]) => [key, el.cloneNode(true)]));
  const ids = new Map();
  for (const root of Object.values(nodes)) {
    if (root.id) ids.set(root.id, root);
    for (const el of root.querySelectorAll('[id]')) ids.set(el.id, el);
  }
  const get = id => ids.get(id);
  // Agendas stay mounted so an earlier round or expanded map survives a phase switch.
  for (const el of nodes.schedule.querySelectorAll('[id]')) el.id = phase.key + '-' + el.id;
  const agenda = document.createElement('details');
  agenda.className = 'panel phase-agenda swiss-agenda';
  const summary = document.createElement('summary');
  summary.textContent = 'Agenda do ' + phase.name;
  const link = nodes.schedule.querySelector('.hltv-event');
  if (phase.key === 'stage-2') link.href = 'https://www.hltv.org/events/9304/matches';
  link.title = summary.textContent + ' na HLTV (abre em nova aba)';
  link.setAttribute('aria-label', link.title);
  nodes.schedule.querySelector('h2').remove();
  nodes.schedule.querySelector('.agenda-toolbar').append(link);
  nodes.schedule.querySelector('.panel-title').remove();
  nodes.schedule.className = 'agenda-body';
  agenda.append(summary, nodes.schedule);
  for (const link of nodes.dashboard.querySelectorAll('a[href="/partidas"], a[href="/modelos"]'))
    link.href = phasePath(link.pathname, phase.id);
  return {
    ...nodes, agenda, entry, active, get, followSchedule: () => active() || agenda.open,
    describe(stage) {
      if (phase === majorPhases[0]) return;
      get('readingRanks').textContent = 'posições mundiais da edição desta fase';
      const link = get('readingRankingLink');
      if (stage.modelStatus?.hltv === 'pending' || !stage.sources.hltv) {
        link.removeAttribute('href');
        link.textContent = 'Ranking HLTV em atualização';
      } else {
        link.href = stage.sources.hltv;
        link.textContent = 'Ranking HLTV usado no ' + phase.name;
      }
      get('readingCutoff').textContent = 'Dados congelados em ' + dateTime.format(Date.parse(stage.cutoff)) +
        ' (UTC-4). Confira o fechamento do cartão no CS2.';
    },
  };
}

export function bindHomePhases(initial, catalog) {
  const main = document.getElementById('majorMain');
  const hero = main.querySelector('.hero-home');
  const nav = hero.querySelector('.phase-picker');
  const agendas = document.getElementById('phaseAgendas');
  const template = document.getElementById('pendingDashboard');
  const picker = bindPhasePickers(initial, catalog, [nav]);
  const templates = {
    dashboard: main.querySelector('.dashboard'), deadline: hero.querySelector('.deadline'),
    editing: document.getElementById('editingBanner'), notes: main.querySelector('.reading'),
    schedule: main.querySelector('section.agenda'),
    suggestion: document.getElementById('suggestion'), choices: document.getElementById('picker'),
    toast: document.getElementById('toast'),
  };
  for (const el of Object.values(templates)) el.remove();
  const panels = document.createElement('div');
  panels.id = 'homePanels';
  for (const link of nav.querySelectorAll('a')) link.setAttribute('aria-controls', 'homePanels phaseAgendas');
  const notes = document.createElement('div');
  main.replaceChildren(hero, panels, agendas, notes);
  const entries = new Map(), pending = new Map(), summaries = new Map();
  for (const phase of majorPhases) {
    const summary = phaseAgenda(phase, { completed: picker.info(phase)?.completed });
    summaries.set(phase, summary);
    agendas.append(summary);
  }
  let current, mounted, deadline;
  const fromHistory = () => majorPhases.find(p => p.key === history.state?.homePhase)
    || selectedPhase(new URL(location.href), catalog?.defaultStage);

  function show(phase) {
    const info = picker.info(phase);
    const ready = phase === majorPhases[0] ||
      Boolean(phase.rosterUrl && info?.rosterConfirmed && info.status !== 'preparing');
    if (phase === current && mounted?.ready === ready) {
      mounted.updateDeadline?.(info, picker.now());
      return;
    }
    mounted?.controls?.pause();
    current = phase;
    picker.select(phase);
    for (const a of document.querySelectorAll('header a')) {
      if (['/modelos', '/partidas'].includes(a.pathname)) a.href = phasePath(a.pathname, phase.id);
    }
    let view;
    if (ready) {
      view = entries.get(phase);
      if (!view) {
        view = swissView(phase, templates, new URL(location.href), () => current === phase);
        view.ready = true;
        entries.set(phase, view);
      }
      const previous = summaries.get(phase);
      if (previous !== view.agenda) {
        previous.replaceWith(view.agenda);
        summaries.set(phase, view.agenda);
      }
    } else {
      if (!pending.has(phase)) pending.set(phase, preparing(phase, template, templates.deadline));
      view = pending.get(phase);
      view.updateDeadline(info, picker.now());
    }
    mounted = view;
    for (const [p, agenda] of summaries) agenda.open = p === phase;
    if (deadline) deadline.replaceWith(view.deadline);
    else hero.append(view.deadline);
    deadline = view.deadline;
    notes.replaceChildren(...(view.notes ? [view.notes] : []));
    panels.replaceChildren(...(ready
      ? [view.editing, view.dashboard, view.suggestion, view.choices, view.toast]
      : [view.dashboard]));
    if (!ready) return;
    if (view.started) {
      view.controls?.resume();
      return;
    }
    view.started = true;
    view.dashboard.inert = true;
    view.dashboard.setAttribute('aria-busy', 'true');
    import('./app.js').then(({ startSwissEdition }) => startSwissEdition(phase, view))
      .then(controls => {
        view.controls = controls;
        view.dashboard.inert = false;
        view.dashboard.removeAttribute('aria-busy');
      }).catch(() => {
        entries.delete(phase);
        view.dashboard.inert = false;
        view.dashboard.removeAttribute('aria-busy');
        const msg = document.createElement('p');
        msg.textContent = 'Não foi possível carregar o cartão do ' + phase.name + '.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'outline';
        retry.textContent = 'Tentar novamente';
        retry.onclick = () => { view.ready = false; show(phase); };
        view.dashboard.replaceChildren(msg, retry);
      });
  }
  nav.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey ||
        event.metaKey || event.shiftKey || event.altKey) return;
    const phase = selectedPhase(new URL(link.href));
    event.preventDefault();
    if (phase !== current) {
      // Keep the home address for ordinary switches. Existing phase-specific links remain entry points.
      const url = new URL(location.href);
      for (const param of ['fase', 'editar', 'simular', 'modelo']) url.searchParams.delete(param);
      url.hash = '';
      history.pushState({ homePhase: phase.key }, '', url);
    }
    show(phase);
  });
  window.addEventListener('popstate', () => show(fromHistory()));
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#c=')) location.reload();
  });
  document.addEventListener('phase-card-writes', ({ detail }) => {
    if (detail.id === current?.id) show(current);
  });
  document.querySelector('header .brand').setAttribute('aria-current', 'page');
  const first = history.state?.homePhase ? fromHistory() : initial;
  history.replaceState({ ...history.state, homePhase: first.key }, '');
  show(first);
}
