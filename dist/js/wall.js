import { modelName, makeMatrix, describeBase, modelAvailable, refreshEditionStudy } from './models.js';
import { phasePath } from './major-phases.js';
import { progress, pickStatus, fixtureBrier } from './progress.js';
import { shareButton } from './share.js';
import { editKey, forgetCard } from './card-access.js';
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
export function loadStageBoard(phase, root, active) {
  const $ = id => root.querySelector('#' + CSS.escape(id));
  let focusId = '', scrolled = false, ready = false;
  const cache = new Map();
  let stage,
    page = 0,
    version,
    job,
    busy = false,
    polled = false;
  let deadline, writesPaused = false,
    clockOffset = 0,
    closeTimer,
    removing,
    deleting = false,
    refreshAgain = false;
  const isLocked = () => writesPaused || !deadline || Date.now() + clockOffset >= deadline;
  function syncLock() {
    clearTimeout(closeTimer);
    const locked = isLocked();
    for (const button of root.querySelectorAll('[data-card-mutation]'))
      button.disabled = locked || (button.id === 'confirmRemove' && deleting);
    $('wallDeadline').textContent = writesPaused ? 'Envio e edição de cartões pausados.' : locked
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
      const res = await fetch(phasePath('/api/cards/' + card.id, stage.id), {
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
      if (active() && location.hash.slice(1) === card.id)
        history.replaceState(null, '', phasePath('/ranking', stage.id));
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
    writesPaused = Boolean(data.writesPaused);
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
    const edition = stage.editionVersion ?? stage.version;
    const signature = JSON.stringify([edition, page, data.cards, data.live.locks, isLocked()]);
    if (version === signature) return;
    const firstRender = !polled;
    version = signature;
    job?.terminate();
    const expanded = new Set(
      [
        ...root.querySelectorAll(
          '#entries .wall-summary[aria-expanded="true"]'
        ),
      ].map((e) => e.dataset.card)
    );
    const container = $('entries');
    container.replaceChildren();
    const pending = new Map();
    job = null;
    function estimate(card, locks, paint) {
      const key = [edition, card.id, card.revision, locks.join(',')].join(':');
      if (cache.has(key)) return paint(cache.get(key));
      if (pending.has(key)) {
        pending.get(key).push(paint);
        return;
      }
      pending.set(key, [paint]);
      if (!job) {
        job = new Worker(new URL('./wall-worker.js', import.meta.url), { type: 'module' });
        job.onmessage = ({ data: { key, value } }) => {
          if (Number.isFinite(value)) {
            if (cache.size >= 500) cache.delete(cache.keys().next().value);
            cache.set(key, value);
          } else version = null;
          for (const update of pending.get(key) || []) update(value);
          pending.delete(key);
        };
        job.onerror = () => {
          for (const updates of pending.values())
            for (const update of updates) update(null);
          pending.clear();
          version = null;
          job?.terminate();
          job = null;
        };
      }
      job.postMessage({ key, settings: card.settings, teams: stage.teams, locks,
        edition: { id: stage.id, editionVersion: edition, modelStatus: stage.modelStatus } });
    }
    for (const c of data.cards) {
      const item = node('div', undefined, 'wall-card');
      item.id = c.id;
      const head = node('button', undefined, 'wall-summary');
      head.type = 'button';
      head.dataset.card = c.id;
      const who = node('span', undefined, 'stage-player');
      const place = node('b', c.place + 'º', 'rank-place');
      if (c.place <= 3 && c.hits > 0) place.classList.add('podium-' + c.place);
      who.append(place, node('strong', c.nick));
      const label = node(
        'span',
        modelName(c.settings.model, c.nick, c.settings.formVersion ?? 1),
        'wall-model'
      );
      const hits = node('b', c.hits + '/10', 'wall-hits'),
        chance = node('span', '', 'wall-chance');
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
      const picks = node('div');
      details.append(picks);
      function buildPickRows() {
        for (const [i, id] of c.settings.card.entries()) {
          if ([0, 2, 8].includes(i))
            picks.append(
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
          picks.append(row);
        }
      }
      const canEstimate = modelAvailable(stage.teams, c.settings.model, c.settings, stage.modelStatus);
      const undecided = c.settings.card.filter((id, i) => pickStatus(i, teams[id]) === 'open').length;
      const certain = c.hits >= 5 ? 1 : c.hits + undecided < 5 ? 0 : null;
      function paintCurrent(value) {
        current.textContent = value === null ? 'Indisponível' : pct(value);
        chance.textContent = value === null ? 'Chance indisponível' : pct(value) + ' de 5+';
      }
      if (!canEstimate) initial.textContent = 'Modelo em preparação';
      if (certain !== null) paintCurrent(certain);
      else if (!canEstimate) chance.textContent = current.textContent = 'Modelo em preparação';
      else {
        chance.textContent = 'Calculando…';
        estimate(c, data.live.locks, paintCurrent);
      }
      function buildModelDetails() {
        if (canEstimate) modelInfo.append(
          node(
            'p',
            'Brier do modelo deste cartão: ' +
              brier(fixtureBrier(makeMatrix(stage.teams, c.settings.model, c.settings), finished)),
            'hint'
          )
        );
        if (c.settings.description && c.settings.model === 'custom')
          modelInfo.append(node('p', c.settings.description));
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
          modelInfo.append(
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
        if (c.settings.model === 'custom') {
          const link = node('a', 'Abrir uma cópia em Modelos');
          link.href = phasePath('/modelos?modelo=' + c.id, stage.id);
          modelInfo.append(link);
        }
      }
      const modelInfo = node('details', undefined, 'card-model-info');
      const modelTitle = node('summary', 'Ver modelo · ' + label.textContent);
      modelInfo.append(modelTitle);
      modelInfo.ontoggle = () => {
        if (modelInfo.open && modelInfo.childElementCount === 1) buildModelDetails();
      };
      const simulate = node('a', 'Simular este cartão', 'simulation-link');
      simulate.href = phasePath('/?simular=' + c.id + '#resultado', stage.id);
      if (isLocked()) details.append(simulate);
      details.append(modelInfo);
      details.id = 'picks-' + c.id;
      head.setAttribute('aria-controls', details.id);
      function expand(open) {
        head.setAttribute('aria-expanded', String(open));
        details.hidden = !open;
        if (open && !picks.childElementCount) buildPickRows();
        if (open && canEstimate && !requested) {
          requested = true;
          estimate(c, c.settings.locks, value => {
            initial.textContent = value === null ? 'Indisponível' : pct(value);
          });
        }
      }
      let requested = false;
      head.onclick = () => expand(details.hidden);
      const bar = node('div', undefined, 'wall-card-head');
      const actions = node('div', undefined, 'wall-actions');
      if (!isLocked() && c.hasEditKey && editKey(stage, c.id)) {
        for (const label of ['Editar', 'Excluir']) {
          const button = node('button', label, 'card-action');
          button.type = 'button';
          button.dataset.cardMutation = '';
          button.setAttribute('aria-label', label + ' cartão de ' + c.nick);
          button.disabled = isLocked();
          button.onclick = () => {
            if (isLocked()) return syncLock();
            if (label === 'Editar') location.assign(phasePath('/?editar=' + c.id, stage.id));
            else showRemove(c);
          };
          actions.append(button);
        }
      }
      actions.append(
        shareButton(phasePath('/ranking#' + c.id, stage.id), 'Compartilhar cartão de ' + c.nick)
      );
      bar.append(head, actions);
      item.append(bar, details);
      container.append(item);
      expand(expanded.has(c.id) || (firstRender && focusId === c.id));
    }
    if (!data.cards.length) {
      const empty = node(
        'p',
        page === 0
          ? 'Ainda não há cartões salvos nesta fase. '
          : 'Nenhum cartão nesta página. '
      );
      const link = node('a', 'Montar meu cartão');
      link.href = phasePath('/', stage.id);
      empty.append(link);
      container.append(empty);
    }
    $('prev').hidden = page === 0;
    $('next').hidden = !data.hasMore;
  }

  async function refresh() {
    if (busy) {
      refreshAgain = true;
      return;
    }
    busy = true;
    $('reload').disabled = true;
    const target = focusId;
    try {
      const url = new URL(phasePath('/api/cards', stage.id), location.origin);
      url.searchParams.set('page', page);
      if (!polled && /^[a-f\d-]{36}$/i.test(target))
        url.searchParams.set('focus', target);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.editionVersion && data.editionVersion !== (stage.editionVersion ?? stage.version)) await loadRoster();
      if (!active()) return;
      if (target !== focusId) { refreshAgain = true; return; }
      page = data.page;
      render(data);
      polled = true;
      if (active() && target && !scrolled) {
        const button = $(target)?.querySelector('.wall-summary');
        if (button) {
          button.focus({ preventScroll: true });
          button.scrollIntoView({ block: 'center' });
          scrolled = true;
        } else $('cardActionMessage').textContent = 'Cartão não encontrado nesta fase.';
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

  async function loadRoster() {
    const res = await fetch(phase.rosterUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error();
    const roster = await res.json();
    if (roster?.id !== phase.id) throw Error('Elenco indisponível para esta fase.');
    await refreshEditionStudy(roster);
    stage = roster;
  }
  async function init() {
    await loadRoster();
    $('cancelRemove').onclick = () => $('removeCard').close();
    $('confirmRemove').onclick = confirmRemove;
    window.addEventListener('pageshow', (event) => {
      if (active() && event.persisted) refresh();
    });
    $('reload').onclick = refresh;
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
    ready = true;
    refresh();
    setInterval(() => {
      if (active() && !document.hidden) refresh();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (active() && !document.hidden) refresh();
    });
  }
  init().catch(() => {
    $('feed').textContent = 'Não foi possível carregar a fase.';
    $('reload').onclick = () => init().catch(() => { $('feed').textContent = 'Falha ao tentar novamente.'; });
  });
  function show(hash) {
    if (hash !== focusId) {
      focusId = hash;
      scrolled = false;
      polled = false;
      version = null;
      $('cardActionMessage').textContent = '';
    }
    if (ready) refresh();
  }
  return { show, pause() {
    job?.terminate();
    job = null;
    version = null;
  } };
}
