import { bindCommunityModels } from './community-models.js';
import { MODELS, makeMatrix, modelName, modelAvailable, FORM_VERSION } from './models.js';
import { bindSuggestions } from './suggestion-dialog.js';
import { bindBracket } from './bracket.js';
import { bindPages, renderCatalog } from './pages.js';
import { bindFeed } from './schedule.js';
import { newDraft, validate, swap, STAGE, personalSettings } from './state.js';
import { bindEditor } from './model-editor.js';
import { bindModelSaving } from './save-model.js';
import { wilson } from './simulation.js';
import { bindSaving, readReceipt } from './save-card.js';
import { bindFollowCard } from './follow-card.js';
import { editKey } from './card-access.js';

const $ = (id) => document.getElementById(id);
const percent = (p) =>
  (100 * p).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + '%';
const number = (x) => x.toLocaleString('pt-BR');
const option = (text, value) => new Option(text, value);
const categories = ['3–0', '3–1 / 3–2', '0–3'];
const category = (slot) => (slot < 2 ? 0 : slot < 8 ? 1 : 2);
let owner,
  publishedName,
  editor,
  modelSaving,
  stage,
  editingCard,
  state,
  worker,
  last,
  delay,
  toastTimer,
  activeRun,
  refreshSaving,
  refreshSuggestion;
let sharedSimulation = new URLSearchParams(location.search).has('simular');
let picksClosed = false, followedCard, localDraft;
const needsCard = () => (picksClosed && !followedCard) || state.card.includes(-1);
function personalNick() {
  if (!followedCard) return publishedName || owner;
  return JSON.stringify(personalSettings(state)) === JSON.stringify(personalSettings(followedCard.settings))
    ? followedCard.nick : publishedName;
}

async function init() {
  const preview = $('nextStage');
  let previewLoaded = false;
  preview.addEventListener('toggle', async () => {
    if (!preview.open || previewLoaded) return;
    previewLoaded = true;
    const detail = $('nextStageInfo');
    detail.textContent = 'Consultando os convidados…';
    try {
      const response = await fetch('/api/stage?stage=sg26-s2-v1');
      if (!response.ok) throw Error();
      const next = await response.json();
      const date = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
      detail.textContent = next.invitedTeams.map(team => team.name).join(' · ') +
        '. Prazo previsto para os picks em ' + date.format(next.closesAt) + ' (Cuiabá).';
    } catch {
      previewLoaded = false;
      detail.textContent = 'A consulta aos convidados está indisponível. Consulte a programação da PGL.';
    }
  });
  const response = await fetch('data/stage.json');
  if (!response.ok) throw new Error('Dados da fase indisponíveis');
  stage = await response.json();
  state = newDraft();
  const receipt = readReceipt(stage);
  const editId = new URLSearchParams(location.search).get('editar');
  if (editId) {
    const res =
      editKey(stage, editId) &&
      (await fetch('/api/cards/' + encodeURIComponent(editId), {
        cache: 'no-store',
      }));
    if (res?.ok) editingCard = await res.json();
    if (!editingCard || editingCard.serverTime >= editingCard.closesAt) {
      location.replace('/ranking?fase=stage-1#' + encodeURIComponent(editId));
      return;
    }
    $('editingTitle').textContent = 'Editando o cartão de ' + editingCard.nick;
    $('cancelEdit').href = '/ranking?fase=stage-1#' + encodeURIComponent(editId);
    $('editingBanner').hidden = false;
  }
  let saved;
  try {
    saved = editingCard
      ? editingCard.settings
      : location.hash.startsWith('#c=')
        ? JSON.parse(atob(location.hash.slice(3)))
        : JSON.parse(localStorage.getItem(STAGE));
    // Early versions could register a card before writing a local draft.
    if (
      !saved &&
      receipt?.saved &&
      receipt.token &&
      !location.hash.startsWith('#c=')
    ) {
      const res = await fetch(
        '/api/cards?focus=' + encodeURIComponent(receipt.token)
      );
      if (res.ok) {
        const wall = await res.json();
        saved = wall.cards.find((card) => card.id === receipt.token)?.settings;
      }
    }
    if (saved && validate(saved, { draft: true })) {
      state = saved;
      let published;
      try {
        published = JSON.parse(
          localStorage.getItem('published-model:' + STAGE)
        );
      } catch {
        /* Storage may be unavailable. */
      }
      const frozen =
        editingCard ||
        receipt?.saved ||
        location.hash.startsWith('#c=') ||
        (published?.signature &&
          published.signature ===
            JSON.stringify([published.nick, personalSettings(state)]));
      state.formVersion ??= frozen ? 1 : FORM_VERSION;
    } else if (saved) toast('Cartão incompatível. Abrimos um cartão vazio.');
  } catch {
    if (location.hash.startsWith('#c='))
      toast('Link inválido. Abrimos um cartão vazio.');
  }
  for (const [id, name] of Object.entries(MODELS))
    $('activeModel').add(option(name, id));
  $('activeModel').value = state.model;
  for (const id of ['left', 'right'])
    stage.teams.forEach((t, i) => $(id).add(option(t.name, i)));
  $('left').value = 13;
  $('right').value = 5;
  if (location.hash.startsWith('#c=')) persist();
  bind();
  refreshSuggestion = bindSuggestions(
    stage.teams,
    () => state,
    () => modelName(state.model, personalNick(), state.formVersion),
    (card) => {
      if (picksClosed) return;
      state.card = [...card];
      renderCard();
      invalidate();
      toast('Sugestão aplicada ao rascunho.');
    }
  );
  editor = bindEditor(
    stage.teams,
    () => state,
    (editing) => {
      const changed = state.model !== 'custom';
      state.model = 'custom';
      $('activeModel').value = 'custom';
      modelSaving?.refresh();
      if (changed || !editing || $('personalName').textContent !== modelName('custom', personalNick()))
        refreshNames();
      else renderDuel();
      invalidate({ editing });
    }
  );
  const community = bindCommunityModels(stage.teams);
  bindPages(stage.teams, (settings) => {
    delete state.weights;
    delete state.base;
    delete state.weight;
    delete state.description;
    Object.assign(state, settings, {
      model: 'custom',
      formVersion: settings.formVersion ?? 1,
    });
    renderSettings();
    refreshNames();
    invalidate();
  }, community.show);
  const follow = bindFollowCard(stage, () => readReceipt(stage), (card, resume, temporary) => {
    if (temporary !== undefined) sharedSimulation = temporary;
    if (!card && !followedCard) return;
    const locks = state.locks;
    if (!followedCard) localDraft = state;
    followedCard = card;
    $('jumpSimulation').hidden = !card;
    if (card) {
      let working;
      if (resume) {
        try { working = JSON.parse(localStorage.getItem('card-simulation:' + STAGE + ':' + card.id)); } catch {}
      }
      const settings = validate(working) && working.card.every((team, i) => team === card.settings.card[i])
        ? working : structuredClone(card.settings);
      state = { ...settings, card: [...card.settings.card], locks, formVersion: settings.formVersion ?? 1 };
    } else state = { ...localDraft, locks };
    renderCard();
    renderSettings();
    refreshNames();
    invalidate();
  });
  refreshSaving = bindSaving(
    () => state,
    stage,
    receipt,
    (nick) => {
      const switchingPerson = Boolean(owner && !nick);
      owner = nick;
      if (switchingPerson) {
        state = { ...newDraft(), locks: state.locks };
        modelSaving?.clear();
        renderCard();
        renderSettings();
        invalidate();
      }
      refreshNames();
    },
    editingCard,
    (closed) => {
      picksClosed = closed;
      $('closedBadge').hidden = $('followCard').hidden = !closed;
      $('pickInstructions').hidden = $('restore').hidden = $('suggest').hidden = closed;
      if (closed) {
        if ($('picker').open) $('picker').close();
        if ($('suggestion').open) $('suggestion').close();
      }
      follow(closed);
      renderCard();
      invalidate();
    }
  );
  modelSaving = bindModelSaving(
    stage,
    () => state,
    (nick) => {
      publishedName = nick;
      refreshNames();
    }
  );
  renderCard();
  renderSettings();
  const bracket = bindBracket(
    stage.teams,
    () => state.locks,
    () => {
      runHint();
      invalidate();
    }
  );
  bindFeed(stage, bracket.setOfficial, (feed) => {
    bracket.setSchedule(feed);
    editor.setSchedule(feed);
    if (feed.locks) community.setLocks(feed.locks);
  });
  runHint();
  start('preview');
}

function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), 3200);
}
function persist() {
  if (editingCard || sharedSimulation) return;
  try {
    if (followedCard) {
      const key = 'card-simulation:' + STAGE + ':' + followedCard.id;
      localStorage.setItem(key, JSON.stringify({ ...state, locks: followedCard.settings.locks }));
      localStorage.setItem(STAGE, JSON.stringify({ ...localDraft, locks: state.locks }));
    } else localStorage.setItem(STAGE, JSON.stringify(state));
  } catch {
    /* Storage may be disabled. */
  }
  if (location.hash.startsWith('#c='))
    history.replaceState(null, '', location.pathname + location.search);
}
function makeTile(teamId, cls, caption = '', tag = 'button') {
  const team = stage.teams[teamId];
  const button = document.createElement(tag);
  button.className = cls;
  const img = new Image();
  img.src = 'assets/' + team.logo;
  img.alt = '';
  const name = document.createElement('span');
  name.textContent = team.name;
  if (caption) {
    const small = document.createElement('small');
    small.textContent = caption;
    name.append(small);
  }
  button.append(img, name);
  return button;
}
function renderCard() {
  $('slots').replaceChildren();
  if (picksClosed && !followedCard) return;
  const count = state.card.filter((team) => team >= 0).length;
  $('pickCount').textContent = count + ' de 10 picks.';
  $('restore').disabled = count === 0;
  refreshSaving?.();
  const labels = [
    'Invictos',
    'Classificados com derrota',
    'Eliminados sem vitória',
  ];
  for (let c = 0; c < 3; c++) {
    const section = document.createElement('div');
    section.className = 'bucket ' + ['high', 'mid', 'low'][c];
    const head = document.createElement('div');
    head.className = 'bucket-head';
    const heading = document.createElement('strong');
    heading.textContent = categories[c];
    head.append(heading, labels[c]);
    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    state.card.forEach((team, slot) => {
      if (category(slot) !== c) return;
      if (picksClosed) {
        tiles.append(makeTile(team, 'tile saved-pick', '', 'div'));
        return;
      }
      const empty = team === -1;
      const b = empty
        ? document.createElement('button')
        : makeTile(team, 'tile');
      if (empty) {
        b.className = 'tile empty-pick';
        b.textContent = 'Escolher equipe';
      }
      b.dataset.slot = slot;
      b.setAttribute(
        'aria-label',
        (empty ? 'Escolher equipe' : 'Trocar ' + stage.teams[team].name) +
          ' na vaga ' +
          categories[c] +
          ', posição ' +
          (slot - [0, 2, 8][c] + 1)
      );
      b.onclick = () => pick(slot);
      tiles.append(b);
    });
    section.append(head, tiles);
    $('slots').append(section);
  }
}
function pick(slot) {
  $('pickCategory').textContent = 'VAGA ' + categories[category(slot)];
  $('choices').replaceChildren();
  stage.teams.forEach((team, i) => {
    const used = state.card.indexOf(i);
    let caption = 'Disponível';
    if (used >= 0)
      caption =
        used === slot
          ? 'Nesta vaga'
          : 'Trocar com ' + categories[category(used)];
    const b = makeTile(i, 'choice', caption);
    b.setAttribute('aria-pressed', String(used === slot));
    b.onclick = () => {
      swap(state.card, slot, i);
      $('picker').close();
      renderCard();
      document.querySelector('[data-slot="' + slot + '"]').focus();
      invalidate();
    };
    $('choices').append(b);
  });
  $('picker').showModal();
}
function renderSettings() {
  editor.render();
  modelSaving?.refresh();
  renderDuel();
}
function renderDuel() {
  const a = Number($('left').value),
    b = Number($('right').value),
    bo = Number($('bo').value);
  $('duel').replaceChildren();
  if (a === b) {
    $('duel').textContent = 'Escolha duas equipes diferentes.';
    return;
  }
  const nick = personalNick();
  for (const key of Object.keys(MODELS)) {
    const line = document.createElement('div');
    line.className = 'duel-row';
    const strong = document.createElement('b');
    strong.textContent = modelAvailable(stage.teams, key, state)
      ? stage.teams[a].short + ' ' + percent(makeMatrix(stage.teams, key, state)[bo][a][b])
      : 'Aguardando estudo da fase';
    const label =
      key === 'hltv'
        ? modelName(key, nick, state.formVersion) +
          ' (#' +
          stage.teams[a].hltvRank +
          ' × #' +
          stage.teams[b].hltvRank +
          ')'
        : modelName(key, nick, state.formVersion);
    line.append(label, strong);
    $('duel').append(line);
  }
}
function refreshNames() {
  const nick = personalNick();
  $('legacyForm').hidden = $('legacyFormHome').hidden = state.formVersion !== 1;
  for (const opt of $('activeModel').options)
    opt.textContent = modelName(
      opt.value,
      nick,
      state.formVersion
    );
  $('activeModel').value = state.model;
  $('personalName').textContent = modelName('custom', nick);
  renderCatalog(
    state.model,
    nick,
    chooseModel,
    state.formVersion
  );
  renderDuel();
  renderEstimate();
}
function runHint() {
  const mode = $('mode').value;
  $('secondsRow').hidden = mode !== 'timed';
  const paths = 2 ** state.locks.filter((x) => x < 0).length;
  $('runHint').textContent =
    mode === 'exact'
      ? 'Enumera ' +
        number(paths) +
        ' caminhos do modelo em destaque. A faixa mostra os limites até terminar.'
      : mode === 'continuous'
        ? 'Simula todos os modelos enquanto a página estiver aberta. Pare quando quiser.'
        : 'A mesma sequência de sorteios permite comparar os modelos.';
}
function renderEstimate() {
  const incomplete = needsCard();
  const nick = personalNick();
  const available = modelAvailable(stage.teams, state.model, state);
  $('run').disabled = incomplete || !available;
  $('suggest').disabled = !available;
  $('saveModel').textContent =
    'Modelo em uso: ' +
    modelName(state.model, nick, state.formVersion);
  const model = state.model;
  const histograms = last?.histograms || {};
  const pass = (h) => h.slice(5).reduce((a, b) => a + b, 0);
  const bounded = last?.kind === 'exact' && last.count < last.total;
  $('prob').classList.toggle('bounds', Boolean(bounded));
  if (bounded) {
    $('prob').textContent = percent(last.lower) + ' – ' + percent(last.upper);
    $('uncertainty').textContent = 'Limites da busca parcial para 5+ acertos.';
  } else if (histograms[model]) {
    const p = pass(histograms[model]);
    $('prob').textContent = percent(p);
    $('uncertainty').textContent =
      last.kind === 'exact'
        ? 'Todos os caminhos foram ponderados.'
        : 'Intervalo de simulação de 95%: ' +
          wilson(p, last.count).map(percent).join(' a ');
  } else {
    $('prob').textContent = '—';
    $('uncertainty').textContent = !available ? 'Este modelo depende do estudo de IA da fase.' : incomplete
      ? (picksClosed ? 'Escolha um cartão salvo para simular.' : 'Complete os dez picks para simular.')
      : 'Calculando a prévia…';
  }
  $('bracketProb').textContent = $('prob').textContent;
  for (const [key, name] of Object.entries(MODELS)) {
    let row = $('comparison').querySelector('[data-model="' + key + '"]');
    if (!row) {
      row = document.createElement('button');
      row.dataset.model = key;
      row.append(name, document.createElement('strong'));
      row.onclick = () => chooseModel(key);
      $('comparison').append(row);
    }
    row.disabled = !modelAvailable(stage.teams, key, state);
    row.firstChild.textContent = modelName(
      key,
      nick,
      state.formVersion
    );
    row.classList.toggle('active', key === model);
    row.setAttribute('aria-pressed', String(key === model));
    row.lastElementChild.textContent = histograms[key]
      ? percent(pass(histograms[key]))
      : '—';
  }
}
function chooseModel(key) {
  if (key === 'study' && !modelAvailable(stage.teams, key, state)) {
    $('activeModel').value = state.model;
    toast('O estudo do Modelo IA desta fase está em preparação.');
    return;
  }
  const changed = state.model !== key;
  state.model = key;
  if (changed) refreshSuggestion?.();
  $('activeModel').value = key;
  persist();
  renderCatalog(
    key,
    personalNick(),
    chooseModel,
    state.formVersion,
    true
  );
  if (changed && (activeRun === 'exact' || last?.kind === 'exact'))
    invalidate();
  else renderEstimate();
}
function cancelWorker() {
  if (worker) worker.terminate();
  worker = null;
  activeRun = null;
  $('stop').hidden = true;
  $('run').hidden = false;
}
function queuePreview() {
  clearTimeout(delay);
  if (!needsCard()) delay = setTimeout(() => start('preview'), 180);
}
function invalidate({ editing = false } = {}) {
  refreshSuggestion?.();
  clearTimeout(delay);
  cancelWorker();
  last = null;
  renderEstimate();
  $('status').textContent = needsCard()
    ? ''
    : editing
      ? 'Ajustando hipóteses…'
      : 'Preparando a prévia…';
  if (!editing) {
    persist();
    queuePreview();
  }
}
function start(mode) {
  clearTimeout(delay);
  if (needsCard()) {
    renderEstimate();
    return;
  }
  if (mode === 'timed' && !$('seconds').reportValidity()) return;
  cancelWorker();
  last = null;
  activeRun = mode;
  renderEstimate();
  $('status').textContent =
    mode === 'preview' ? 'Preparando a prévia…' : 'Calculando…';
  $('stop').hidden = mode === 'preview';
  $('run').hidden = mode !== 'preview';
  const current = new Worker(new URL('./worker.js', import.meta.url), {
    type: 'module',
  });
  worker = current;
  current.onmessage = ({ data }) => {
    if (current !== worker) return;
    last = data;
    renderEstimate();
    const status =
      data.kind === 'exact'
        ? number(data.count) + ' / ' + number(data.total) + ' caminhos'
        : number(data.count) + ' simulações por modelo';
    if (data.done) {
      cancelWorker();
      $('status').textContent =
        status +
        (data.stopped
          ? ' · interrompido'
          : mode === 'preview'
            ? ' · prévia'
            : ' · concluído');
    } else $('status').textContent = status + ' · em andamento';
  };
  current.onerror = () => {
    if (current !== worker) return;
    cancelWorker();
    $('status').textContent = 'Falha no cálculo. Tente simular novamente.';
  };
  current.postMessage({
    mode,
    state,
    teams: stage.teams,
    seconds: Number($('seconds').value),
  });
}
function bind() {
  $('upgradeForm').onclick = () => {
    state.formVersion = FORM_VERSION;
    renderSettings();
    modelSaving?.refresh();
    refreshNames();
    invalidate();
  };
  $('activeModel').onchange = (e) => chooseModel(e.target.value);
  for (const id of ['left', 'right', 'bo']) $(id).onchange = renderDuel;
  $('restore').onclick = () => {
    state.card = newDraft().card;
    renderCard();
    invalidate();
    toast('Picks removidos.');
  };
  $('mode').onchange = runHint;
  $('run').onclick = () => start($('mode').value);
  $('stop').onclick = () => worker?.postMessage({ stop: true });
  $('close').onclick = () => $('picker').close();
  window.addEventListener('hashchange', () => {
    if (location.hash.startsWith('#c=')) location.reload();
  });
}
init().catch(() => {
  $('status').textContent =
    'Não foi possível carregar a fase. Recarregue a página.';
});
