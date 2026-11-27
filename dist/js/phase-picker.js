import { majorPhases } from './major-phases.js';

const labels = {
  'picks-open': 'Aberto',
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

function sectionAvailable(phase, stage) {
  return phase === majorPhases[0] || Boolean(phase.rosterUrl && stage?.rosterConfirmed &&
    (stage.completed || ['open', 'locked', 'paused'].includes(stage.status)));
}

export function bindSectionNavigation(navs, catalog, initial, show) {
  const picker = bindPhasePickers(initial, catalog, navs, update);
  const overall = navs[0].dataset.destination === '/ranking';
  const notice = document.createElement('p');
  notice.className = 'hint';
  notice.role = 'status';
  notice.hidden = true;
  let selected, currentAddress;
  function update() {
    const url = new URL(location.href);
    const path = url.pathname.replace(/\/$/, '');
    const nav = navs.find(item => item.dataset.destination === path);
    if (!nav) return;
    const key = url.searchParams.get('fase') ||
      (history.state?.section === path && history.state.phase);
    const requested = majorPhases.find(p => p.key === key) || (key === 'geral' ? null : initial);
    const locked = requested && !sectionAvailable(requested, picker.info(requested));
    const fallback = overall ? null : majorPhases.findLast(p => sectionAvailable(p, picker.info(p)));
    notice.hidden = !locked;
    if (locked) notice.textContent = requested.name + ' em preparação. Exibindo ' + (fallback?.name || 'o ranking geral') + '.';
    const phase = locked ? fallback : requested;
    const address = locked ? new URL(path, url.origin) : url;
    if (phase === selected && address.href === currentAddress) return;
    selected = phase;
    currentAddress = address.href;
    picker.select(phase);
    show(phase, address);
    const anchor = nav.closest('.group-hero') ?? nav;
    if (anchor.nextElementSibling !== notice) anchor.after(notice);
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.altKey) return;
    const isPhaseTab = navs.some(nav => nav.contains(link));
    const cardLink = overall && link.hasAttribute('data-ranking-card');
    const sectionLink = link.closest('header') && navs.some(nav => nav.dataset.destination === link.pathname);
    if (!isPhaseTab && !cardLink && !sectionLink) return;
    const target = new URL(link.href);
    const path = target.pathname;
    const key = target.searchParams.get('fase') || 'geral';
    const next = majorPhases.find(p => p.key === key);
    if (cardLink && (!next || !sectionAvailable(next, picker.info(next)))) return;
    event.preventDefault();
    if (isPhaseTab && notice.hidden && key === (selected?.key || 'geral')) return;
    history.pushState({ section: path, phase: key }, '', isPhaseTab ? path : target);
    update();
    if (sectionLink) window.scrollTo(0, 0);
  });
  window.addEventListener('popstate', update);
  window.addEventListener('hashchange', update);
  update();
}

export function bindPhasePickers(selected, initialCatalog, pickers = document.querySelectorAll('.phase-picker'), onUpdate) {
  const tabs = [], generals = [];
  for (const nav of pickers) {
    const path = nav.dataset.destination;
    if (path === '/ranking') {
      const general = document.createElement('a');
      general.href = path;
      general.textContent = 'Geral';
      general.className = 'all-phases';
      if (!selected) general.setAttribute('aria-current', 'page');
      nav.append(general);
      generals.push(general);
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
      tabs.push({ tab, badge, phase, path, restricted: path !== '/' });
    }
  }

  let catalog = initialCatalog;
  let lastSuccess = catalog ? Date.now() : 0;
  let busy = false;
  function render(fresh) {
    for (const { tab, badge, phase, path, restricted } of tabs) {
      const stage = catalog?.stages.find(item => item.id === phase.id);
      if (restricted && !sectionAvailable(phase, stage)) {
        tab.removeAttribute('href');
        tab.setAttribute('role', 'link');
        tab.setAttribute('aria-disabled', 'true');
        badge.dataset.state = 'locked';
        badge.textContent = stage?.startDate || phase.startDate;
        tab.title = phase.name + ' em preparação · Início previsto em ' + badge.textContent;
        tab.setAttribute('aria-label', tab.title);
        continue;
      }
      tab.href = path + '?fase=' + phase.key;
      tab.removeAttribute('role');
      tab.removeAttribute('aria-disabled');
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
      if (updated) onUpdate?.();
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
      for (const general of generals) {
        if (!phase) general.setAttribute('aria-current', 'page');
        else general.removeAttribute('aria-current');
      }
      for (const item of tabs) {
        if (item.phase === phase) item.tab.setAttribute('aria-current', 'page');
        else item.tab.removeAttribute('aria-current');
      }
    },
    now: () => Number.isFinite(catalog?.serverTime) ? catalog.serverTime + (Date.now() - lastSuccess) : Date.now(),
    info: phase => catalog?.stages.find(stage => stage.id === phase.id),
  };
}
