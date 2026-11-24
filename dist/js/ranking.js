import { majorPhases as phases } from './major-phases.js';
import { modelName } from './models.js';
import { bindPhasePickers, readStageCatalog } from './phase-picker.js';

const $ = (id) => document.getElementById(id);
function element(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function link(text, href) {
  const a = element('a', text);
  a.href = href;
  return a;
}

const url = new URL(location.href);
if (/^\/cartoes(?:\/|\.html)?$/.test(url.pathname)) {
  url.pathname = '/ranking';
  url.searchParams.set('fase', 'stage-1');
  history.replaceState(history.state, '', url);
}
const phase = phases.find(p => p.key === url.searchParams.get('fase'));

function phaseState(stage, pick) {
  if (pick) return String(pick.hits);
  if (!stage || stage.status === 'preparing') return 'Futura';
  return 'Sem cartão';
}

function initOverall() {
  $('overallBoard').hidden = false;
  const previous = history.state?.overall || {};
  const expanded = new Set(previous.expanded);
  let page = previous.page || 0, signature, busy = false, restore = previous.scroll;
  function remember() {
    history.replaceState({ ...history.state, overall: { page, expanded: [...expanded], scroll: scrollY } }, '');
  }
  window.addEventListener('pagehide', remember);
  function render(data) {
    $('rankingStatus').textContent = data.rows.length
      ? 'A classificação soma os acertos confirmados. Empates dividem a posição.' +
        (data.stale ? ' Exibindo a última chave disponível.' : '')
      : 'Nenhum cartão registrado nesta página.';
    $('prevRank').hidden = !page;
    $('nextRank').hidden = !data.hasMore;
    const next = JSON.stringify([page, data.rows, data.stages]);
    if (next === signature) return;
    signature = next;
    const body = $('standings');
    const focused = body.contains(document.activeElement) ? document.activeElement.id : '';
    body.replaceChildren();
    for (const player of data.rows) {
      const row = body.insertRow();
      const place = element('b', player.place + 'º', 'rank-place');
      if (player.hits && player.place <= 3) place.classList.add('podium-' + player.place);
      row.insertCell().append(place);
      const nick = element('button', player.nick, 'rank-nick');
      nick.type = 'button';
      nick.id = 'nick-' + player.id;
      row.insertCell().append(nick);
      const detail = body.insertRow();
      detail.id = 'phases-' + player.id;
      nick.setAttribute('aria-controls', detail.id);
      const cell = detail.insertCell();
      cell.colSpan = 7;
      const list = element('ul', undefined, 'phase-details');
      cell.append(list);
      for (const p of phases) {
        const card = player.phases[p.id];
        const state = phaseState(data.stages.find(s => s.id === p.id), card);
        const score = row.insertCell();
        score.className = 'stage-score' + (card ? '' : ' unplayed');
        score.textContent = state;
        const item = element('li');
        item.append(element('b', p.name));
        if (card) {
          const view = link('Ver cartão', '/ranking?fase=' + p.key + '#' + card.id);
          view.setAttribute('aria-label', 'Ver cartão de ' + player.nick + ' no ' + p.name);
          view.id = 'view-' + card.id;
          view.addEventListener('click', remember);
          item.append(element('span', card.hits + (card.hits === 1 ? ' acerto' : ' acertos') +
            ' · ' + modelName(card.model, card.nick, card.formVersion)), view);
        } else item.append(element('span', state === 'Futura' ? 'Fase futura' : state));
        list.append(item);
      }
      row.insertCell().append(element('strong', String(player.hits), 'rank-total'));
      function toggle(open) {
        detail.hidden = !open;
        nick.setAttribute('aria-expanded', String(open));
      }
      toggle(expanded.has(player.id));
      nick.onclick = () => {
        if (detail.hidden) expanded.add(player.id); else expanded.delete(player.id);
        toggle(expanded.has(player.id));
        remember();
      };
    }
    if (focused) $(focused)?.focus({ preventScroll: true });
    if (restore != null) {
      window.scrollTo(0, restore);
      restore = null;
    }
  }
  async function refresh() {
    if (busy) return;
    busy = true;
    const controls = [$('reloadRanking'), $('prevRank'), $('nextRank')];
    controls.forEach(button => { button.disabled = true; });
    try {
      const res = await fetch('/api/ranking/geral?page=' + page, { cache: 'no-store' });
      if (!res.ok) throw Error();
      render(await res.json());
    } catch {
      $('rankingStatus').textContent = 'Não foi possível atualizar o ranking. Tente novamente.';
    } finally {
      busy = false;
      controls.forEach(button => { button.disabled = false; });
    }
  }
  $('prevRank').onclick = () => { if (page) page--; refresh(); };
  $('nextRank').onclick = () => { page++; refresh(); };
  $('reloadRanking').onclick = refresh;
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
}

async function start() {
  if (!phase) initOverall();
  const catalog = await readStageCatalog();
  bindPhasePickers(phase, catalog);
  if (!phase) return;
  const info = catalog?.stages.find(item => item.id === phase.id);
  if (phase.key === 'stage-1' || (phase.format === 'swiss' && info?.rosterConfirmed && info.status !== 'preparing')) {
    $('stageBoard').querySelector('h2').textContent = 'Classificação do ' + phase.name;
    $('stageBoard').hidden = false;
    import('./wall.js').then(module => module.loadStageBoard(phase)).catch(() => {
      $('feed').textContent = 'Não foi possível abrir ' + phase.name + '. Recarregue a página.';
    });
  } else {
    $('futureBoard').hidden = false;
    $('futureName').textContent = phase.name;
    $('futureStatus').textContent = phase.key === 'stage-2'
      ? 'Em preparação. Os cartões aparecerão aqui quando a fase abrir.'
      : 'Fase futura. A classificação estará disponível quando houver cartões.';
  }
}
start();
