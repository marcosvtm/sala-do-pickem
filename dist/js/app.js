import { MODELS, makeMatrix, modelName } from './models.js';
import { bindBracket } from './bracket.js';
import { bindPages, renderCatalog } from './pages.js';
import { bindFeed } from './schedule.js';
import { defaults, validate, swap, STAGE } from './state.js';
import { wilson } from './simulation.js';
import { bindSaving } from './save-card.js';

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
let owner, stage, state, worker, last, delay, toastTimer, activeRun;

async function init() {
  const response = await fetch('data/stage.json');
  if (!response.ok) throw new Error('Dados da fase indisponíveis');
  stage = await response.json();
  state = defaults(stage.card);
  let saved;
  try {
    saved = location.hash.startsWith('#c=')
      ? JSON.parse(atob(location.hash.slice(3)))
      : JSON.parse(localStorage.getItem(STAGE));
    if (saved && validate(saved)) state = saved;
    else if (saved) toast('Cartão incompatível. Carregamos o cartão inicial.');
  } catch {
    if (location.hash.startsWith('#c='))
      toast('Link inválido. Carregamos o cartão inicial.');
  }
  for (const [id, name] of Object.entries(MODELS))
    $('activeModel').add(option(name, id));
  $('activeModel').value = state.model;
  for (const id of ['left', 'right', 'editTeam'])
    stage.teams.forEach((t, i) => $(id).add(option(t.name, i)));
  $('editTeam').value = 13;
  $('left').value = 13;
  $('right').value = 5;
  if (location.hash.startsWith('#c=')) persist();
  bind();
  bindPages(stage.teams, ({ form, trust, bonus, description }) => {
    Object.assign(state, {
      model: 'custom',
      form,
      trust: [...trust],
      bonus: [...bonus],
      description,
    });
    renderSettings();
    refreshNames();
    invalidate();
  });
  bindSaving(
    () => state,
    stage,
    (nick) => {
      owner = nick;
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
  bindFeed(stage, official);
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
      const b = makeTile(team, 'tile');
      b.dataset.slot = slot;
      b.setAttribute(
        'aria-label',
        'Trocar ' + stage.teams[team].name + ' na vaga ' + categories[c]
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
  $('hypothesis').value = state.description || '';
  const t = Number($('editTeam').value);
  for (const [key, value] of [
    ['form', state.form],
    ['trust', state.trust[t]],
    ['bonus', state.bonus[t]],
  ]) {
    $(key).value = value;
    $(key + 'Val').textContent =
      key === 'bonus' ? (value > 0 ? '+' : '') + value + ' p.p.' : value + '%';
  }
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
    line.append(modelName(key, owner), strong);
    $('duel').append(line);
  }
}
function refreshNames() {
  for (const opt of $('activeModel').options)
    opt.textContent = modelName(opt.value, owner);
  $('activeModel').value = state.model;
  $('personalName').textContent = modelName('custom', owner);
  renderCatalog(state.model, owner, chooseModel);
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
        ? 'Amostra os quatro modelos enquanto a página estiver aberta. Pare quando quiser.'
        : 'A mesma sequência de sorteios permite comparar os quatro modelos.';
}
function renderEstimate() {
  $('saveModel').textContent =
    'Modelo em uso: ' + modelName(state.model, owner);
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
    $('uncertainty').textContent = 'Calculando a prévia…';
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
    row.firstChild.textContent = modelName(key, owner);
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
  renderCatalog(key, owner, chooseModel);
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
  delay = setTimeout(() => start('preview'), 180);
}
function invalidate({ editing = false } = {}) {
  clearTimeout(delay);
  cancelWorker();
  last = null;
  renderEstimate();
  $('status').textContent = editing
    ? 'Ajustando hipóteses…'
    : 'Preparando a prévia…';
  if (!editing) {
    persist();
    queuePreview();
  }
}
function start(mode) {
  clearTimeout(delay);
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
  $('hypothesis').oninput = () => {
    state.description = $('hypothesis').value;
    chooseModel('custom');
  };
  $('editTeam').onchange = renderSettings;
  for (const id of ['left', 'right', 'bo']) $(id).onchange = renderDuel;
  for (const id of ['form', 'trust', 'bonus']) {
    let pending = false;
    const finishEdit = () => {
      if (!pending) return;
      pending = false;
      renderCatalog(state.model, owner, chooseModel);
      persist();
      queuePreview();
    };
    $(id).oninput = () => {
      const n = Number($(id).value);
      if (id === 'form') state.form = n;
      else state[id][Number($('editTeam').value)] = n;
      state.model = 'custom';
      $('activeModel').value = state.model;
      renderSettings();
      pending = true;
      invalidate({ editing: true });
    };
    $(id).onchange = finishEdit;
    // A drag can end back on its initial value, or be cancelled by touch.
    $(id).onlostpointercapture = finishEdit;
    $(id).onblur = finishEdit;
  }
  $('resetModel').onclick = () => {
    const base = defaults(stage.card);
    Object.assign(state, {
      description: '',
      form: base.form,
      trust: base.trust,
      bonus: base.bonus,
      model: 'custom',
    });
    chooseModel('custom');
    renderSettings();
    invalidate();
  };
  $('restore').onclick = () => {
    state.card = [...stage.card];
    renderCard();
    invalidate();
    toast('Cartão inicial restaurado.');
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
