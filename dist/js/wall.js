import { MODELS, modelName, makeMatrix, describeBase } from './models.js';
import { progress, pickStatus, fixtureBrier } from './progress.js';
import { shareButton } from './share.js';
import { editKey, forgetCard } from './card-access.js';
import { newDraft } from './state.js';
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
const pct = (x) =>
  (x * 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }) + '%';
const brier = (x) =>
  x === null
    ? 'Aguardando partidas'
    : x.toLocaleString('pt-BR', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
const date = (ms) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Cuiaba',
  }).format(ms);
const cache = new Map();
let stage,
  page = 0,
  version,
  job,
  busy = false,
  polled = false;
let deadline,
  clockOffset = 0,
  closeTimer,
  removing,
  deleting = false,
  refreshAgain = false;
const isLocked = () => !deadline || Date.now() + clockOffset >= deadline;
function syncLock() {
  clearTimeout(closeTimer);
  const locked = isLocked();
  for (const button of document.querySelectorAll('[data-card-mutation]'))
    button.disabled = locked || (button.id === 'confirmRemove' && deleting);
  $('wallDeadline').textContent = locked
    ? 'Prazo encerrado. Os cartões desta fase estão fechados.'
    : 'Você pode editar ou excluir seus cartões neste navegador até ' +
      date(deadline) +
      ' (Cuiabá).';
  if (locked && $('removeCard').open)
    $('removeError').textContent = 'O prazo desta fase terminou.';
  if (!locked)
    closeTimer = setTimeout(
      syncLock,
      Math.min(deadline - Date.now() - clockOffset + 1, 2147483647)
    );
}
function showRemove(card) {
  if (isLocked()) return syncLock();
  removing = card;
  $('removeInfo').textContent =
    'O cartão de ' +
    card.nick +
    ' e sua cópia do modelo serão retirados do mural.';
  $('removeError').textContent = '';
  $('removeCard').showModal();
}
async function confirmRemove() {
  const card = removing;
  if (!card || deleting || isLocked()) return syncLock();
  deleting = true;
  syncLock();
  try {
    const res = await fetch('/api/cards/' + card.id, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Card-Key': editKey(stage, card.id),
      },
      body: JSON.stringify({ revision: card.revision }),
    });
    if (!res.ok)
      throw Error((await res.json()).message || 'Falha ao excluir o cartão.');
    forgetCard(stage, card.id);
    $('removeCard').close();
    $('cardActionMessage').textContent =
      'Cartão de ' + card.nick + ' excluído.';
    if (location.hash.slice(1) === card.id)
      history.replaceState(null, '', '/cartoes');
    if (page > 0 && $('entries').childElementCount === 1) page--;
    await refresh();
  } catch (error) {
    $('removeError').textContent =
      error.message || 'Falha ao excluir o cartão.';
  } finally {
    deleting = false;
    syncLock();
  }
}
function render(data) {
  deadline = data.closesAt;
  clockOffset = data.serverTime - Date.now();
  syncLock();
  const { teams, finished } = progress(data.live.locks);
  $('feed').textContent =
    finished.length +
    ' de 33 partidas encerradas' +
    (data.live.checked
      ? ' · Última leitura ' + date(data.live.checked) + ' (Cuiabá)'
      : '') +
    (data.live.stale
      ? ' · Fonte indisponível ou em atualização. Exibindo a última chave confirmada.'
      : finished.length === 0
        ? ' · Aguardando o primeiro resultado.'
        : '');
  const signature = JSON.stringify([page, data.cards, data.live.locks]);
  if (version === signature) return;
  const firstRender = !version;
  version = signature;
  job?.terminate();
  const expanded = new Set(
    [
      ...document.querySelectorAll(
        '#entries .wall-summary[aria-expanded="true"]'
      ),
    ].map((e) => e.dataset.card)
  );
  const container = $('entries');
  container.replaceChildren();
  const waiting = [],
    outputs = new Map();
  for (const c of data.cards) {
    const item = node('div', undefined, 'wall-card');
    item.id = c.id;
    const head = node('button', undefined, 'wall-summary');
    head.type = 'button';
    head.dataset.card = c.id;
    const who = node('strong', c.nick);
    const label = node(
      'span',
      modelName(c.settings.model, c.nick, c.settings.formVersion ?? 1),
      'wall-model'
    );
    const hits = node('b', c.hits + '/10', 'wall-hits'),
      chance = node('span', 'Calculando…', 'wall-chance');
    head.append(who, label, hits, chance);
    const initial = node('b', '…'),
      current = node('b', '…');
    const info = node('p', undefined, 'wall-meta');
    info.append(
      'Salvo em ' + date(c.submitted * 1000) + ' (Cuiabá) · Chance inicial ',
      initial,
      ' · Agora ',
      current
    );
    const details = node('div', undefined, 'wall-details');
    details.append(info);
    if (!c.hasEditKey && !isLocked()) {
      details.append(
        node(
          'p',
          'Este cartão foi salvo antes da edição por navegador e está disponível para consulta.',
          'hint'
        )
      );
    }
    for (const [i, id] of c.settings.card.entries()) {
      if ([0, 2, 8].includes(i))
        details.append(
          node('h3', i === 0 ? '3–0' : i === 2 ? '3–1 / 3–2' : '0–3')
        );
      const status = pickStatus(i, teams[id]),
        row = node('div', undefined, 'pick-outcome');
      const img = new Image();
      img.alt = '';
      img.src = '/assets/' + stage.teams[id].logo;
      row.append(
        img,
        node('span', stage.teams[id].name),
        node(
          'b',
          { hit: 'Acertou', miss: 'Errou', open: 'Em aberto' }[status],
          status
        )
      );
      details.append(row);
    }
    const matrix = makeMatrix(stage.teams, c.settings.model, c.settings);
    details.append(
      node(
        'p',
        'Brier do modelo deste cartão: ' +
          brier(fixtureBrier(matrix, finished)),
        'hint'
      )
    );
    if (c.settings.description && c.settings.model === 'custom')
      details.append(node('p', c.settings.description));
    if (c.settings.model === 'custom') {
      const tweaks = c.settings.trust
        .map((t, i) =>
          t !== 100 || c.settings.bonus[i] !== 0
            ? stage.teams[i].name +
              ' (confiança ' +
              t +
              '%, ajuste ' +
              c.settings.bonus[i] +
              ' p.p.)'
            : null
        )
        .filter(Boolean);
      details.append(
        node(
          'p',
          describeBase(c.settings) +
            (c.settings.formVersion === 2
              ? '. Forma recente revisada.'
              : '. Forma recente da edição anterior.') +
            (tweaks.length ? ' ' + tweaks.join(' · ') : ''),
          'hint'
        )
      );
    }
    details.id = 'picks-' + c.id;
    head.setAttribute('aria-controls', details.id);
    function expand(open) {
      head.setAttribute('aria-expanded', String(open));
      details.hidden = !open;
    }
    expand(
      expanded.has(c.id) || (firstRender && location.hash.slice(1) === c.id)
    );
    head.onclick = () => expand(details.hidden);
    const bar = node('div', undefined, 'wall-card-head');
    const actions = node('div', undefined, 'wall-actions');
    if (c.hasEditKey && editKey(stage, c.id)) {
      for (const label of ['Editar', 'Excluir']) {
        const button = node('button', label, 'card-action');
        button.type = 'button';
        button.dataset.cardMutation = '';
        button.setAttribute('aria-label', label + ' cartão de ' + c.nick);
        button.disabled = isLocked();
        button.onclick = () => {
          if (isLocked()) return syncLock();
          if (label === 'Editar') location.assign('/?editar=' + c.id);
          else showRemove(c);
        };
        actions.append(button);
      }
    }
    actions.append(
      shareButton('/cartoes#' + c.id, 'Compartilhar cartão de ' + c.nick)
    );
    bar.append(head, actions);
    item.append(bar, details);
    container.append(item);
    const key = c.id + ':' + c.revision + ':' + data.live.locks.join(',');
    const paint = ({ initial: p, current: q }) => {
      initial.textContent = pct(p);
      current.textContent = pct(q);
      chance.textContent = pct(q) + ' de 5+';
    };
    if (cache.has(key)) paint(cache.get(key));
    else {
      waiting.push(c);
      outputs.set(c.id, { paint, key });
    }
  }
  if (!data.cards.length) {
    const empty = node(
      'p',
      page === 0
        ? 'Ainda não há cartões salvos nesta fase. '
        : 'Nenhum cartão nesta página. '
    );
    const link = node('a', 'Montar meu cartão');
    link.href = '/';
    empty.append(link);
    container.append(empty);
  }
  if (waiting.length) {
    job = new Worker(new URL('./wall-worker.js', import.meta.url), {
      type: 'module',
    });
    job.onmessage = ({ data: result }) => {
      const out = outputs.get(result.id);
      if (!out) return;
      if (cache.size > 500) cache.clear();
      cache.set(out.key, result);
      out.paint(result);
    };
    job.onerror = () => {
      for (const e of document.querySelectorAll('.wall-chance'))
        if (e.textContent === 'Calculando…')
          e.textContent = 'Estimativa indisponível';
      version = null;
    };
    job.postMessage({
      cards: waiting,
      teams: stage.teams,
      locks: data.live.locks,
    });
  }
  $('prev').hidden = page === 0;
  $('next').hidden = !data.hasMore;
  $('modelScores').replaceChildren();
  for (const model of Object.keys(MODELS).filter((id) => id !== 'custom')) {
    const row = node('div', undefined, 'duel-row');
    row.append(
      MODELS[model],
      node(
        'b',
        brier(
          fixtureBrier(makeMatrix(stage.teams, model, newDraft()), finished)
        )
      )
    );
    $('modelScores').append(row);
  }
}

let modelsPage = 0,
  loadingModels = false,
  modelsVersion;
async function refreshModels() {
  if (loadingModels) return;
  loadingModels = true;
  try {
    const res = await fetch('/api/models?page=' + modelsPage, {
      cache: 'no-store',
    });
    if (!res.ok) throw Error();
    const data = await res.json(),
      sig = JSON.stringify([modelsPage, data]);
    if (sig !== modelsVersion) {
      const rows = data.models.map((m) => {
        const row = node('div', undefined, 'saved-model-row'),
          link = node('a', modelName('custom', m.nick));
        link.href = '/modelos?modelo=' + encodeURIComponent(m.id);
        const info = node(
          'span',
          m.source === 'card' ? 'Salvo com o cartão' : 'Modelo publicado',
          'hint'
        );
        info.append(' · ' + date(m.submitted * 1000) + ' (Cuiabá)');
        const entry = node('div');
        entry.append(link, info);
        row.append(
          entry,
          shareButton(link.href, 'Compartilhar modelo de ' + m.nick)
        );
        return row;
      });
      $('savedModels').replaceChildren(
        ...(rows.length
          ? rows
          : [
              node(
                'p',
                'Os modelos aparecem aqui quando alguém salva um modelo ou um cartão.',
                'hint'
              ),
            ])
      );
      $('modelsPrev').hidden = !modelsPage;
      $('modelsNext').hidden = !data.hasMore;
      modelsVersion = sig;
    }
  } catch {
    if (!modelsVersion)
      $('savedModels').textContent = 'Não foi possível carregar os modelos.';
  } finally {
    loadingModels = false;
  }
}

async function refresh() {
  if (busy) {
    refreshAgain = true;
    return;
  }
  refreshModels();
  busy = true;
  $('reload').disabled = true;
  const target = location.hash.slice(1);
  try {
    const url = new URL('/api/cards', location.origin);
    url.searchParams.set('page', page);
    if (!polled && /^[a-f\d-]{36}$/i.test(target))
      url.searchParams.set('focus', target);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const data = await res.json();
    page = data.page;
    polled = true;
    render(data);
    if (target && !window.wallScrolled && document.getElementById(target)) {
      document.getElementById(target).scrollIntoView({ block: 'center' });
      window.wallScrolled = true;
    }
  } catch {
    $('feed').textContent =
      'Não foi possível atualizar o mural. Tente novamente.';
  } finally {
    busy = false;
    $('reload').disabled = false;
    if (refreshAgain) {
      refreshAgain = false;
      refresh();
    }
  }
}
async function init() {
  const res = await fetch('/data/stage.json');
  if (!res.ok) throw new Error();
  stage = await res.json();
  $('cancelRemove').onclick = () => $('removeCard').close();
  $('confirmRemove').onclick = confirmRemove;
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refresh();
  });
  $('reload').onclick = refresh;
  for (const [id, d] of [
    ['modelsPrev', -1],
    ['modelsNext', 1],
  ])
    $(id).onclick = () => {
      if (!loadingModels) {
        modelsPage += d;
        refreshModels();
      }
    };
  for (const [id, d] of [
    ['prev', -1],
    ['next', 1],
  ])
    $(id).onclick = () => {
      if (!busy) {
        page += d;
        refresh();
      }
    };
  await refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}
init().catch(
  () =>
    ($('feed').textContent = 'Falha ao carregar a fase. Recarregue a página.')
);
