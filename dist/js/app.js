import { MODELS, makeMatrix, modelName } from './models.js';
import { bindBracket } from './bracket.js';
import { bindPages, renderCatalog } from './pages.js';
import { bindFeed } from './schedule.js';
import { newDraft, validate, swap, STAGE } from './state.js';
import { bindEditor } from './model-editor.js';
import { bindModelSaving } from './save-model.js';
import { wilson } from './simulation.js';
import { bindSaving, readReceipt } from './save-card.js';

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
  state,
  worker,
  last,
  delay,
  toastTimer,
  activeRun,
  refreshSaving;

async function init() {
  const response = await fetch('data/stage.json');
  if (!response.ok) throw new Error('Dados da fase indisponíveis');
  stage = await response.json();
  state = newDraft();
  const receipt = readReceipt(stage);
  let saved;
  try {
    saved = location.hash.startsWith('#c=')
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
    if (saved && validate(saved, { draft: true })) state = saved;
    else if (saved) toast('Cartão incompatível. Abrimos um cartão vazio.');
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
  editor = bindEditor(
    stage.teams,
    () => state,
    (editing) => {
      state.model = 'custom';
      $('activeModel').value = 'custom';
      if (!editing)
        renderCatalog('custom', publishedName || owner, chooseModel);
      modelSaving?.refresh();
      renderDuel();
      invalidate({ editing });
    }
  );
  bindPages(stage.teams, (settings) => {
    delete state.base;
    delete state.weight;
    delete state.description;
    Object.assign(state, settings, { model: 'custom' });
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
  const official = bindBracket(
    stage.teams,
    () => state.locks,
    () => {
      runHint();
      invalidate();
    }
  );
  bindFeed(stage, official, editor.setSchedule);
  runHint();
  start('preview');
}

function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').textContent = ''), 3200);
}
function persist() {
  try {
    localStorage.setItem(STAGE, JSON.stringify(state));
  } catch {
    /* Storage may be disabled. */
  }
  if (location.hash.startsWith('#c='))
    history.replaceState(null, '', location.pathname + location.search);
}
function makeTile(teamId, cls, caption = '') {
  const team = stage.teams[teamId];
  const button = document.createElement('button');
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
  for (const key of Object.keys(MODELS)) {
    const p = makeMatrix(stage.teams, key, state)[bo][a][b];
    const line = document.createElement('div');
    line.className = 'duel-row';
    const strong = document.createElement('b');
    strong.textContent = stage.teams[a].short + ' ' + percent(p);
    const label =
      key === 'hltv'
        ? modelName(key, publishedName || owner) +
          ' (#' +
          stage.teams[a].hltvRank +
          ' × #' +
          stage.teams[b].hltvRank +
          ')'
        : modelName(key, publishedName || owner);
    line.append(label, strong);
    $('duel').append(line);
  }
}
function refreshNames() {
  for (const opt of $('activeModel').options)
    opt.textContent = modelName(opt.value, publishedName || owner);
  $('activeModel').value = state.model;
  $('personalName').textContent = modelName('custom', publishedName || owner);
  renderCatalog(state.model, publishedName || owner, chooseModel);
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
  const incomplete = state.card.includes(-1);
  $('run').disabled = incomplete;
  $('saveModel').textContent =
    'Modelo em uso: ' + modelName(state.model, publishedName || owner);
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
    $('uncertainty').textContent = incomplete
      ? 'Complete os dez picks para simular.'
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
    row.firstChild.textContent = modelName(key, publishedName || owner);
    row.classList.toggle('active', key === model);
    row.setAttribute('aria-pressed', String(key === model));
    row.lastElementChild.textContent = histograms[key]
      ? percent(pass(histograms[key]))
      : '—';
  }
}
function chooseModel(key) {
  const changed = state.model !== key;
  state.model = key;
  $('activeModel').value = key;
  persist();
  renderCatalog(key, publishedName || owner, chooseModel);
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
  if (!state.card.includes(-1)) delay = setTimeout(() => start('preview'), 180);
}
function invalidate({ editing = false } = {}) {
  clearTimeout(delay);
  cancelWorker();
  last = null;
  renderEstimate();
  $('status').textContent = state.card.includes(-1)
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
  if (state.card.includes(-1)) {
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
