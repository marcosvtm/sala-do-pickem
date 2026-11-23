import { MODELS, explanations, modelName } from './models.js';

export function renderCatalog(selected, nick, choose) {
  const tiles = Object.keys(MODELS).map((id) => {
    const button = document.createElement('button'),
      name = document.createElement('strong'),
      desc = document.createElement('span'),
      status = document.createElement('small');
    button.type = 'button';
    button.className = 'model-tile';
    name.textContent = modelName(id, nick);
    desc.textContent = explanations[id];
    button.setAttribute('aria-pressed', String(id === selected));
    status.textContent =
      id === selected ? 'Em uso no cartão' : 'Usar no cartão';
    button.append(name, desc, status);
    button.onclick = () => choose(id);
    return button;
  });
  document.getElementById('catalog').replaceChildren(...tiles);
}
export function bindPages(teams, apply) {
  const $ = (id) => document.getElementById(id);
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
        model.description ||
        'Ajustes salvos com o cartão de ' + model.nick + '.';
      const info = document.createElement('p');
      info.textContent = 'Peso da forma recente: ' + model.form + '%.';
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
        apply(model);
        history.replaceState(null, '', '/modelos');
        render();
        $('modelos').scrollIntoView({ block: 'start' });
        $('hypothesis').focus({ preventScroll: true });
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
    if (location.href !== link.href) history.pushState(null, '', link.href);
    render();
    window.scrollTo(0, 0);
  });
  window.addEventListener('popstate', render);
  render();
}
