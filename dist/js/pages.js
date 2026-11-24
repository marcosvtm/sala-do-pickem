import { phasePath, majorPhases } from './major-phases.js';
import { MODELS, explanations, modelName, describeBase, studyFor } from './models.js';
import { personalSettings } from './state.js';

export function renderCatalog(
  selected,
  nick,
  choose,
  formVersion,
  reopen = false
) {
  const catalog = document.getElementById('catalog');
  for (const id of Object.keys(MODELS)) {
    let button = document.getElementById('tile-' + id);
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
    description.textContent =
      id === 'elo' && formVersion === 1
        ? 'Esta cópia usa o Elo anterior à revisão regional.'
        : explanations[id];
    button.setAttribute('aria-pressed', String(id === selected));
    button.disabled = id === 'study' && catalog.dataset.studyPending === 'true';
    status.textContent = button.disabled ? 'Estudo em preparação'
      : id === selected ? 'Em uso no cartão' : 'Usar no cartão';
  }
  document.getElementById('legacyFormGuide').hidden = formVersion !== 1;
  document.getElementById('revisedFormGuide').hidden = formVersion === 1;
  if (reopen || catalog.dataset.selected !== selected) {
    const guide = document.getElementById('guide-' + selected);
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
export function bindPages(stage, apply, onModels) {
  const { teams } = stage;
  const $ = (id) => document.getElementById(id);
  const phase = majorPhases.find(p => p.id === stage.id);
  if (phase.key !== 'stage-1') {
    const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' });
    const cutoff = when.format(new Date(stage.cutoff)) + ' (Cuiabá)';
    $('vrsEdition').textContent = 'ranking global usado no ' + phase.name;
    $('formCutoff').textContent = cutoff;
    $('hltvPhase').textContent = 'o ' + phase.name;
    $('readingRanks').textContent = 'posições mundiais da edição desta fase';
    for (const link of [$('hltvEdition'), $('readingRankingLink')]) {
      link.href = stage.sources.hltv;
      link.textContent = 'Ranking HLTV usado no ' + phase.name;
    }
    $('readingCutoff').textContent = 'Dados congelados em ' + cutoff + '. Estreia prevista para ' +
      when.format(new Date(stage.startsAt)) + ' (Cuiabá). Confira o fechamento do cartão no CS2.';
    const study = studyFor(phase.id);
    $('catalog').dataset.studyPending = String(!study);
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
  for (const team of teams) {
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
  const rankedTeams = [...teams].sort((a, b) => a.hltvRank - b.hltvRank);
  for (const team of rankedTeams) {
    const item = document.createElement('li');
    const rank = document.createElement('strong');
    rank.textContent = '#' + team.hltvRank;
    item.append(rank, ' ' + team.name);
    $('hltvPositions').append(item);
  }
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
        history.replaceState(null, '', phasePath('/modelos', stage.id));
        render();
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
  function render() {
    const legacy = { '#jogos': '/partidas', '#modelos': '/modelos' };
    if (legacy[location.hash])
      history.replaceState(null, '', legacy[location.hash]);
    const path = location.pathname.replace(/\/$/, '') || '/';
    const id =
      path === '/modelos' && new URLSearchParams(location.search).get('modelo');
    for (const el of document.querySelectorAll('[data-page]'))
      el.hidden = !el.dataset.page.split(' ').includes(path) || (el.id === 'importPanel' && !id);
    for (const a of document.querySelectorAll('header a')) {
      if (a.pathname === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title =
      ({
        '/': "Pick'em dos Broxinhas",
        '/partidas': 'Partidas',
        '/modelos': 'Modelos',
      }[path] || "Pick'em dos Broxinhas") + ' · Singapura 2026';
    if (path === '/modelos') onModels();
    if (id && id !== requested) {
      showPublic(id);
      $('importPanel').scrollIntoView({ block: 'start' });
    } else if (!id) requested = null;
  }
  function navigate(path) {
    const params = new URLSearchParams(location.search);
    const target = new URL(path, location.origin);
    if (params.has('fase') || params.has('editar') || params.has('modelo') || params.has('simular'))
      target.search = new URL(phasePath(path, stage.id), location.origin).search;
    if (params.get('editar')) target.searchParams.set('editar', params.get('editar'));
    path = target.pathname + target.search;
    if (location.pathname + location.search + location.hash !== path)
      history.pushState(null, '', path);
    render();
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (
      !link ||
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      link.origin !== location.origin ||
      !['/', '/partidas', '/modelos'].includes(link.pathname) ||
      link.search ||
      link.hash
    )
      return;
    e.preventDefault();
    navigate(link.pathname);
  });
  window.addEventListener('popstate', render);
  render();
}
