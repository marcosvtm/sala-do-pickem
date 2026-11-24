import { phasePath } from './major-phases.js';
import { MODELS, modelName, makeMatrix, modelAvailable } from './models.js';
import { progress, fixtureBrier } from './progress.js';
import { newDraft } from './state.js';
import { shareButton } from './share.js';
const $ = (id) => document.getElementById(id);
const node = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
};
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
let modelsPage = 0,
  loadingModels = false,
  modelsVersion;
async function refreshModels(stageId) {
  if (loadingModels) return;
  loadingModels = true;
  try {
    const res = await fetch(phasePath('/api/models?page=' + modelsPage, stageId), {
      cache: 'no-store',
    });
    if (!res.ok) throw Error();
    const data = await res.json(),
      sig = JSON.stringify([modelsPage, data]);
    if (sig !== modelsVersion) {
      const rows = data.models.map((m) => {
        const row = node('div', undefined, 'saved-model-row'),
          link = node('a', modelName('custom', m.nick));
        link.href = phasePath('/modelos?modelo=' + encodeURIComponent(m.id), stageId);
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


export function bindCommunityModels(stage) {
  const { teams } = stage;
  const refresh = () => refreshModels(stage.id);
  for (const [id, d] of [
    ['modelsPrev', -1],
    ['modelsNext', 1],
  ])
    $(id).onclick = () => {
      if (!loadingModels) {
        modelsPage += d;
        refresh();
      }
    };
  const comparison = $('modelComparison');
  let latest;
  function compare() {
    if (!comparison.open || !latest) return;
    const { finished } = progress(latest);
    $('modelScores').replaceChildren();
    const settings = newDraft(stage.id);
    for (const model of Object.keys(MODELS).filter((id) => id !== 'custom' && modelAvailable(teams, id, settings))) {
      const row = node('div', undefined, 'duel-row');
      row.append(
        MODELS[model],
        node(
          'b',
          brier(
            fixtureBrier(makeMatrix(teams, model, settings), finished)
          )
        )
      );
      $('modelScores').append(row);
    }
  }
  comparison.addEventListener('toggle', compare);
  document.addEventListener('model-published', refresh);
  return {
    show: refresh,
    setLocks(locks) {
      if (JSON.stringify(latest) === JSON.stringify(locks)) return;
      latest = locks;
      compare();
    },
  };
}
