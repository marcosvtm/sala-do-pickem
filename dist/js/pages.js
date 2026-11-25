import { phasePath, majorPhases } from './major-phases.js';
import { MODELS, explanations, modelName, describeBase, studyFor, modelAvailable } from './models.js';
import { personalSettings } from './state.js';

export function renderCatalog(
  selected,
  nick,
  choose,
  formVersion,
  $,
  available,
  reopen = false
) {
  const catalog = $('catalog');
  const descriptions = {};
  if (formVersion === 1) descriptions.elo = 'Esta cópia usa o Elo anterior à revisão regional.';
  if (catalog.dataset.studyPending === 'true') {
    descriptions.study = 'O estudo desta fase aguarda a análise dos participantes e dos confrontos.';
    descriptions.custom = 'Combine os modelos disponíveis e ajuste a força de cada equipe desta fase.';
  } else if (catalog.dataset.studyVersion) {
    descriptions.study = 'Usa as probabilidades de MD1 e MD3 do estudo específico desta fase.';
  }
  for (const id of Object.keys(MODELS)) {
    let button = $('tile-' + id);
    if (!button) {
      button = document.createElement('button');
      button.id = 'tile-' + id;
      button.type = 'button';
      button.className = 'model-tile';
      button.setAttribute('aria-controls', 'guide-' + id);
      button.append(
        ...['strong', 'span', 'small'].map((tag) => document.createElement(tag))
      );
      button.onclick = () => choose(id);
      catalog.append(button);
    }
    const [name, description, status] = button.children;
    name.textContent = modelName(id, nick, formVersion);
    description.textContent = descriptions[id] || explanations[id];
    button.setAttribute('aria-pressed', String(id === selected));
    button.disabled = id !== 'custom' && !available(id);
    status.textContent = button.disabled ? (id === 'study' ? 'Estudo em preparação' : 'Em atualização')
      : id === selected ? 'Em uso no cartão' : 'Usar no cartão';
  }
  $('legacyFormGuide').hidden = formVersion !== 1;
  $('revisedFormGuide').hidden = formVersion === 1;
  if (reopen || catalog.dataset.selected !== selected) {
    const guide = $('guide-' + selected);
    for (const other of guide.parentElement.querySelectorAll('details[open]'))
      if (other !== guide) other.open = false;
    if (
      guide !== guide.parentElement.firstElementChild &&
      !guide.contains(document.activeElement)
    )
      guide.parentElement.prepend(guide);
    guide.open = true;
    catalog.dataset.selected = selected;
  }
}
export function bindPages(stage, apply, view) {
  const { teams } = stage;
  const $ = view.get;
  const phase = majorPhases.find(p => p.id === stage.id);
  const available = key => modelAvailable(teams, key, { stage: stage.id, formVersion: 2 }, stage.modelStatus);
  const dated = value => value?.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
  function updateEdition() {
    if (phase.key !== 'stage-1') {
      const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' });
      const cutoff = when.format(new Date(stage.cutoff)) + ' (Cuiabá)';
      const vrs = document.createElement('a');
      if (available('vrs')) vrs.href = stage.sources.vrs;
      vrs.target = '_blank';
      vrs.rel = 'noopener noreferrer';
      vrs.textContent = available('vrs')
        ? 'ranking global ' + (stage.modelDates?.vrs ? 'de ' + dated(stage.modelDates.vrs) : 'usado no ' + phase.name)
        : 'ranking global da Valve (em atualização)';
      $('vrsEdition').replaceChildren(vrs);
      $('formCutoff').textContent = cutoff;
      if (stage.formCoverage === 'history-plus-stage1') {
        $('formScope').textContent = 'Para esta edição, o histórico congelado em 20/11 foi atualizado com as séries oficiais do Stage 1. A janela de 120 dias é contada até o corte desta fase.';
        $('formScope').hidden = false;
      }
      $('hltvPhase').textContent = 'o ' + phase.name;
      $('readingRanks').textContent = 'posições mundiais da edição desta fase';
      for (const link of [$('hltvEdition'), $('readingRankingLink')]) {
        if (available('hltv')) link.href = stage.sources.hltv;
        else link.removeAttribute('href');
        link.textContent = available('hltv')
          ? 'Ranking HLTV ' + (stage.modelDates?.hltv ? 'de ' + dated(stage.modelDates.hltv) : 'usado no ' + phase.name)
          : 'Ranking HLTV em atualização';
      }
      $('readingCutoff').textContent = 'Dados congelados em ' + cutoff + '. Estreia prevista para ' +
        when.format(new Date(stage.startsAt)) + ' (Cuiabá). Confira o fechamento do cartão no CS2.';
      const study = available('study') && studyFor(phase.id);
      $('catalog').dataset.studyPending = String(!study);
      if (study) $('catalog').dataset.studyVersion = study.version;
      else delete $('catalog').dataset.studyVersion;
      const guide = $('guide-study'), summary = guide.querySelector('summary');
      const description = document.createElement('p');
      description.textContent = study
        ? 'O estudo do ' + phase.name + ' estima cada um dos 120 duelos em MD1 e MD3. A simulação e a busca de cartões usam as probabilidades da edição ' + study.version + ', com dados até ' + when.format(new Date(study.cutoff)) + ' (Cuiabá).'
        : 'As probabilidades do ' + phase.name + ' aguardam o estudo desta fase. As previsões estarão disponíveis após a conferência dos 16 times e das matrizes de MD1 e MD3.';
      guide.replaceChildren(summary, description);
      if (study?.sourceUrl) {
        const link = document.createElement('a');
        link.className = 'study-link';
        link.href = study.sourceUrl;
        link.textContent = 'Leia o estudo do Modelo IA para o ' + phase.name;
        guide.append(link);
      }
    }
    $('formEvidence').replaceChildren();
    for (const team of available('elo') ? teams : []) {
      if (!team.formEvidence) continue;
      const e = team.formEvidence;
      const row = $('formEvidence').insertRow();
      const header = document.createElement('th');
      header.scope = 'row';
      header.textContent = team.name;
      row.append(header);
      for (const value of [
        e.series,
        e.opponents,
        e.externalOpponents,
        e.unknownSeries,
      ])
        row.insertCell().textContent = value;
    }
    const rankedTeams = available('hltv') ? [...teams].sort((a, b) => a.hltvRank - b.hltvRank) : [];
    $('hltvPositions').replaceChildren();
    for (const team of rankedTeams) {
      const item = document.createElement('li');
      const rank = document.createElement('strong');
      rank.textContent = '#' + team.hltvRank;
      item.append(rank, ' ' + team.name);
      $('hltvPositions').append(item);
    }
  }
  updateEdition();
  // Keep the clicked header under the pointer when another guide above it closes.
  $('modelGuides').addEventListener('click', (event) => {
    const header = event.target.closest('.model-guide > summary');
    if (!header) return;
    const top = header.getBoundingClientRect().top;
    requestAnimationFrame(() => {
      const delta = header.getBoundingClientRect().top - top;
      if (Math.abs(delta) > 1)
        window.scrollBy({ top: delta, behavior: 'instant' });
    });
  });
  let requested;
  async function showPublic(id) {
    requested = id;
    $('importCopy').hidden = true;
    $('importName').textContent = 'Modelo compartilhado';
    $('importSettings').replaceChildren();
    $('importInfo').textContent = 'Buscando os ajustes…';
    try {
      const res = await fetch(phasePath('/api/models/' + encodeURIComponent(id), stage.id));
      if (!res.ok) throw Error();
      const model = await res.json();
      if (requested !== id) return;
      $('importName').textContent = modelName('custom', model.nick);
      $('importInfo').textContent =
        model.description || 'Ajustes publicados por ' + model.nick + '.';
      const info = document.createElement('p');
      info.textContent =
        describeBase(model) +
        '. ' +
        (model.formVersion === 2
          ? 'Forma recente com ajuste regional.'
          : 'Forma recente da edição anterior.');
      const changes = teams.flatMap((t, i) =>
        model.trust[i] === 100 && model.bonus[i] === 0
          ? []
          : [
              t.name +
                ' · confiança ' +
                model.trust[i] +
                '% · ajuste ' +
                model.bonus[i] +
                ' p.p.',
            ]
      );
      $('importSettings').append(info);
      for (const line of changes) {
        const p = document.createElement('p');
        p.textContent = line;
        $('importSettings').append(p);
      }
      if (!changes.length)
        info.append(
          ' Todas as equipes têm 100% de confiança e ajuste de 0 p.p.'
        );
      $('importCopy').hidden = false;
      $('importCopy').onclick = () => {
        apply(personalSettings(model));
        history.replaceState({ ...history.state, section: '/modelos', phase: phase.key }, '', '/modelos');
        show(new URL(location.href));
        $('guide-custom').open = true;
        $('modelos').scrollIntoView({ block: 'start' });
        $(model.weights || model.base ? 'mix-neutral' : 'startMix').focus({
          preventScroll: true,
        });
      };
    } catch {
      if (requested === id)
        $('importInfo').textContent =
          'Não foi possível abrir este modelo. Confira o link e tente novamente.';
    }
  }
  function show(entry) {
    const id = entry.searchParams.get('modelo');
    $('importPanel').hidden = !id || view.path !== '/modelos';
    if (id && view.path === '/modelos' && id !== requested) {
      showPublic(id);
      if (view.active()) $('importPanel').scrollIntoView({ block: 'start' });
    } else if (!id) requested = null;
  }
  show.refreshEdition = updateEdition;
  return show;
}
