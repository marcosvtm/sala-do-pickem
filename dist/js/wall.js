import { MODELS, modelName, makeMatrix } from './models.js';
import { progress, pickStatus, fixtureBrier } from './progress.js';
import { shareButton } from './share.js';
import { defaults } from './state.js';
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
function render(data) {
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
  version = signature;
  job?.terminate();
  const expanded = new Set(
    [...document.querySelectorAll('#entries details[open]')].map((e) => e.id)
  );
  const container = $('entries');
  container.replaceChildren();
  const waiting = [],
    outputs = new Map();
  for (const c of data.cards) {
    const item = node('details', undefined, 'wall-card');
    item.id = c.id;
    const head = node('summary');
    const who = node('strong', c.nick);
    const label = node(
      'span',
      modelName(c.settings.model, c.nick),
      'wall-model'
    );
    const hits = node('b', c.hits + '/10', 'wall-hits'),
      chance = node('span', 'Calculando…', 'wall-chance');
    head.append(who, label, hits, chance);
    item.append(head);
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
          'Peso da forma recente: ' +
            c.settings.form +
            '%.' +
            (tweaks.length ? ' ' + tweaks.join(' · ') : ''),
          'hint'
        )
      );
    }
    item.append(details);
    item.open = expanded.has(c.id) || location.hash.slice(1) === c.id;
    const wrap = node('div', undefined, 'wall-card-wrap');
    wrap.append(
      item,
      shareButton('/cartoes#' + c.id, 'Compartilhar cartão de ' + c.nick)
    );
    container.append(wrap);
    const key = c.id + ':' + data.live.locks.join(',');
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
  for (const model of ['neutral', 'vrs', 'elo']) {
    const row = node('div', undefined, 'duel-row');
    row.append(
      MODELS[model],
      node(
        'b',
        brier(
          fixtureBrier(
            makeMatrix(stage.teams, model, defaults(stage.card)),
            finished
          )
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
        row.append(
          link,
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
                'Os modelos aparecem aqui quando alguém salva um cartão.',
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
  refreshModels();
  if (busy) return;
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
  }
}
async function init() {
  const res = await fetch('/data/stage.json');
  if (!res.ok) throw new Error();
  stage = await res.json();
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
