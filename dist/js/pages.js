import { MODELS, explanations, modelName, describeBase } from './models.js';
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
    status.textContent =
      id === selected ? 'Em uso no cartão' : 'Usar no cartão';
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
export function bindPages(teams, apply, suggestStudy) {
  const $ = (id) => document.getElementById(id);
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
      const res = await fetch('/api/models/' + encodeURIComponent(id));
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
        history.replaceState(null, '', '/modelos');
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
      el.hidden = el.dataset.page !== path || (el.id === 'importPanel' && !id);
    for (const a of document.querySelectorAll('header a')) {
      if (a.pathname === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    document.title =
      ({
        '/': 'Sala do Pick’Em',
        '/partidas': 'Partidas',
        '/modelos': 'Modelos',
      }[path] || 'Sala do Pick’Em') + ' · Singapura 2026';
    if (id && id !== requested) {
      showPublic(id);
      $('importPanel').scrollIntoView({ block: 'start' });
    } else if (!id) requested = null;
  }
  function navigate(path) {
    if (location.pathname + location.search + location.hash !== path)
      history.pushState(null, '', path);
    render();
    window.scrollTo(0, 0);
  }
  $('studySuggest').onclick = () => {
    navigate('/');
    suggestStudy();
  };
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
