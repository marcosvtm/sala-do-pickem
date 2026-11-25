import { phasePath } from './major-phases.js';
import { bindSectionNavigation } from './phase-picker.js';
import { startSwissEdition } from './app.js';

export function bindSwissSection(initial, catalog) {
  const main = document.getElementById('majorMain');
  const heroes = {
    '/modelos': main.querySelector('.models-hero'),
    '/partidas': main.querySelector('.matches-hero'),
  };
  for (const hero of Object.values(heroes)) {
    hero.remove();
    hero.hidden = false;
  }
  heroes['/modelos'].querySelector('.kicker span').textContent = 'PGL MAJOR · SINGAPURA';
  heroes['/partidas'].querySelector('.kicker span').textContent = 'PGL MAJOR · SISTEMA SUÍÇO';
  const home = main.querySelector('.hero-home');
  const deadline = home.querySelector('.deadline');
  deadline.hidden = true;
  home.replaceWith(deadline);
  main.querySelector('#phaseAgendas').remove();
  const loading = main.querySelector('#phasePreview');
  loading.remove();
  const schedule = main.querySelector('section.agenda');
  main.querySelector('#jogos').after(schedule);
  main.querySelector('#pendingDashboard').remove();
  const template = document.createElement('div');
  template.append(...main.children);
  template.append(...document.querySelectorAll('body > dialog, body > #toast'));
  const host = document.createElement('div');
  host.id = 'sectionContent';
  main.replaceChildren(loading, host);
  const views = new Map();
  let current, mountedHero;

  function show(phase, entry) {
    if (phase !== current) views.get(current)?.controls?.pause();
    current = phase;
    const path = entry.pathname.replace(/\/$/, '');
    const hero = heroes[path];
    if (mountedHero !== hero) {
      mountedHero?.remove();
      main.prepend(hero);
      mountedHero = hero;
    }
    const title = hero.querySelector('h1');
    title.textContent = (path === '/modelos' ? 'Modelos' : 'Partidas') + ' · ' + phase.name;
    document.title = title.textContent + " · Pick'em dos Broxinhas";
    for (const link of document.querySelectorAll('header a')) {
      if (['/', '/partidas', '/modelos'].includes(link.pathname)) {
        const target = new URL(phasePath(link.pathname, phase.id), location.origin);
        if (entry.searchParams.has('editar')) target.searchParams.set('editar', entry.searchParams.get('editar'));
        link.href = target;
      }
      if (link.pathname === path) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    function showPanels(root) {
      for (const section of root.querySelectorAll('[data-page]')) {
        section.hidden = !section.dataset.page.split(' ').includes(path) ||
          (section.id === 'importPanel' && !entry.searchParams.has('modelo'));
      }
    }
    let view = views.get(phase);
    if (view) {
      view.path = path;
      showPanels(view.root);
      view.entry = entry;
      host.replaceChildren(view.root);
      loading.hidden = !view.pending;
      view.controls?.resume();
      return;
    }
    const root = template.cloneNode(true);
    const get = id => root.querySelector('#' + CSS.escape(id));
    view = { get, root, path, entry, active: () => current === phase, pending: true };
    views.set(phase, view);
    showPanels(root);
    const agenda = root.querySelector('section.agenda');
    agenda.querySelector('h2').textContent = 'Agenda do ' + phase.name;
    const hltv = agenda.querySelector('.hltv-event');
    if (phase.key === 'stage-2') hltv.href = 'https://www.hltv.org/events/9304/matches';
    hltv.title = 'Agenda do ' + phase.name + ' na HLTV (abre em nova aba)';
    hltv.setAttribute('aria-label', hltv.title);
    root.querySelector('.bracket-panel h2').textContent = 'Chaveamento do ' + phase.name;
    root.querySelector('.community-models h2').textContent = 'Modelos da galera · ' + phase.name;
    host.replaceChildren(root);
    root.hidden = true;
    loading.hidden = false;
    loading.querySelector('h2').textContent = 'Carregando ' + phase.name + '…';
    loading.querySelector('p').replaceChildren();
    startSwissEdition(phase, view).then(controls => {
      view.controls = controls;
      view.pending = false;
      root.hidden = false;
      if (view.active()) {
        loading.hidden = true;
        if (view.path === '/modelos' && view.entry.searchParams.has('modelo')) get('importPanel').scrollIntoView({ block: 'start' });
      } else controls?.pause();
    }).catch(() => {
      views.delete(phase);
      if (!view.active()) return;
      loading.hidden = false;
      loading.querySelector('h2').textContent = 'Não foi possível carregar o ' + phase.name + '.';
      const retry = document.createElement('button');
      retry.className = 'outline';
      retry.textContent = 'Tentar novamente';
      retry.onclick = () => show(phase, view.entry);
      loading.querySelector('p').replaceChildren(retry);
    });
  }
  const pickers = Object.values(heroes).map(hero => hero.querySelector('.phase-picker'));
  bindSectionNavigation(pickers, catalog, initial, show);
}
