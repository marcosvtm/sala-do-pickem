import { makeMatrix, fieldStrength } from './models.js';
import { bindMixer } from './mixer.js';
import { newDraft } from './state.js';
import { matchLink } from './schedule.js';
import { progress } from './progress.js';

const $ = (id) => document.getElementById(id);
const percent = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const when = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Cuiaba',
});
const columns = {
  neutral: 'Neutro',
  vrs: 'Valve',
  hltv: 'HLTV',
  elo: 'Forma',
  study: 'IA',
  custom: 'Seu modelo',
};

function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

export function bindEditor(teams, current, onEdit) {
  const list = $('strengthList'),
    rows = [],
    fixed = {},
    strengths = {};
  const sortLabels = { team: 'Equipe', ...columns };
  let sortKey = 'team',
    ascending = true;
  const formatControl = $('strengthFormat');
  const strengthFormat = () =>
    Number(formatControl.querySelector(':checked').value);
  for (const key of ['neutral', 'vrs', 'hltv', 'study'])
    fixed[key] = makeMatrix(teams, key, current());
  let fixedVersion;
  let personal,
    feed,
    records,
    openTeam = null;
  function sliderEvents(input, write) {
    let dirty = false;
    input.oninput = () => {
      write(Number(input.value));
      dirty = true;
      render({ keepTeamInPlace: true });
      onEdit(true);
    };
    const finish = () => {
      if (!dirty) return;
      dirty = false;
      onEdit(false);
    };
    input.onchange = finish;
    input.onlostpointercapture = finish;
    input.onblur = finish;
  }
  function slider(panel, id, key, label, hint, min, max) {
    const name = element('label', null, label),
      input = element('input'),
      value = element('output');
    input.type = 'range';
    input.id = key + '-' + id;
    input.min = min;
    input.max = max;
    name.htmlFor = input.id;
    value.setAttribute('for', input.id);
    name.append(value);
    const group = element('div', 'team-control');
    group.append(name, input, element('p', 'hint', hint));
    panel.append(group);
    sliderEvents(input, (n) => {
      current()[key][id] = n;
    });
    return { input, value };
  }
  function renderGame(id) {
    const box = rows[id].game;
    const game = feed?.games
      .filter((g) => g.status !== 'end' && (g.a === id || g.b === id))
      .sort(
        (a, b) =>
          Number(b.status === 'live') - Number(a.status === 'live') ||
          a.at - b.at
      )[0];
    const record = records?.[id],
      other = game && (game.a === id ? game.b : game.a);
    if (!game || other == null || !personal?.[game.bo]) {
      box.textContent =
        record?.wins === 3
          ? 'Classificado para o Stage 2.'
          : record?.losses === 3
            ? 'Eliminado do Stage 1.'
            : feed
              ? 'Aguardando adversário.'
              : 'Consultando a agenda…';
      return;
    }
    const heading = element(
      'strong',
      null,
      (game.status === 'live'
        ? 'Em jogo contra '
        : 'Próximo confronto contra ') + teams[other].name
    );
    const chance = element(
      'b',
      'fixture-chance',
      percent.format(personal[game.bo][id][other]) + ' de vitória'
    );
    const details = element(
      'span',
      'hint',
      'Rodada ' +
        game.round +
        ' · MD' +
        game.bo +
        ' · ' +
        when.format(game.at) +
        ' (Cuiabá) · ' +
        (feed.stale ? 'Última agenda disponível da PGL' : 'Agenda PGL')
    );
    box.replaceChildren(heading, chance, details);
    const url = matchLink(game, feed.base);
    if (url) {
      const a = element('a', null, 'Partida na HLTV');
      a.href = url;
      box.append(a);
    }
  }
  function expand(id) {
    if (openTeam !== null) {
      const old = rows[openTeam];
      old.panel.hidden = true;
      old.button.setAttribute('aria-expanded', 'false');
      applyOrder();
    }
    openTeam = openTeam === id ? null : id;
    if (openTeam !== null) {
      rows[id].panel.hidden = false;
      rows[id].button.setAttribute('aria-expanded', 'true');
      renderGame(id);
    }
  }
  teams.forEach((team, id) => {
    const wrap = element('div', 'strength-team'),
      button = element('button', 'strength-row'),
      panel = element('div', 'team-editor');
    button.type = 'button';
    button.dataset.team = id;
    panel.id = 'team-editor-' + id;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', panel.id);
    button.onclick = () => expand(id);
    const name = element('span', 'strength-name'),
      img = new Image();
    img.src = '/assets/' + team.logo;
    img.alt = '';
    name.append(img, team.name);
    button.append(name);
    const values = {};
    for (const [key, title] of Object.entries(columns)) {
      const cell = element('span', 'strength-cell ' + key),
        v = element('b');
      cell.append(element('small', null, title), v);
      button.append(cell);
      values[key] = v;
    }
    const controls = element('div', 'team-controls');
    const trust = slider(
      controls,
      id,
      'trust',
      'Confiança na força prevista',
      'Em 100%, cada modelo usa a força que calculou para este time. Em 0%, usa a força média das 16 equipes.',
      0,
      100
    );
    const bonus = slider(
      controls,
      id,
      'bonus',
      'Ajuste de desempenho no Major',
      'Com zero pontos no neutro, +5 p.p. leva um duelo equilibrado a 55% contra um rival sem ajuste.',
      -15,
      15
    );
    const game = element('div', 'team-fixture');
    panel.append(controls, game);
    wrap.append(button, panel);
    rows[id] = { wrap, button, panel, values, trust, bonus, game };
  });
  const alphabetical = teams
    .map((_, i) => i)
    .sort((a, b) =>
      teams[a].name.localeCompare(teams[b].name, 'pt-BR', { numeric: true })
    );
  const sortHeader = $('strengthSort');
  for (const [key, label] of Object.entries(sortLabels)) {
    const button = element('button', null, label);
    button.type = 'button';
    button.dataset.column = key;
    button.setAttribute('aria-controls', list.id);
    button.onclick = () => {
      ascending = key === sortKey ? !ascending : key === 'team';
      sortKey = key;
      applyOrder();
    };
    sortHeader.append(button);
  }
  function applyOrder(keepTeamInPlace = false) {
    const byName = sortKey === 'team';
    const order = [...alphabetical];
    if (byName && !ascending) order.reverse();
    if (!byName) {
      const scores = strengths[sortKey];
      order.sort((a, b) =>
        ascending ? scores[a] - scores[b] : scores[b] - scores[a]
      );
    }
    const moved = order.some((id, i) => list.children[i] !== rows[id].wrap);
    if (moved && !keepTeamInPlace) {
      const focus = list.contains(document.activeElement)
        ? document.activeElement
        : null;
      list.append(...order.map((id) => rows[id].wrap));
      focus?.focus({ preventScroll: true });
    }
    for (const button of sortHeader.children) {
      const selected = button.dataset.column === sortKey;
      button.setAttribute('aria-pressed', String(selected));
      button.dataset.arrow = selected ? (ascending ? '↑' : '↓') : '';
    }
    const direction = byName
      ? (ascending ? 'A–Z' : 'Z–A')
      : (ascending ? 'menor para maior' : 'maior para menor');
    const status = sortLabels[sortKey] + ' · ' + direction +
      (moved && keepTeamInPlace ? ' · Reordena ao fechar a equipe' : '');
    if ($('strengthOrder').textContent !== status)
      $('strengthOrder').textContent = status;
  }
  function render({ keepTeamInPlace = false } = {}) {
    const s = current(),
      bo = strengthFormat();
    const version = s.formVersion ?? 1;
    if (version !== fixedVersion) {
      fixed.elo = makeMatrix(teams, 'elo', s);
      fixedVersion = version;
    }
    renderMixer();
    personal = makeMatrix(teams, 'custom', s);
    const matrices = { ...fixed, custom: personal };
    for (const key of Object.keys(columns)) {
      const values = fieldStrength(matrices[key][bo]);
      strengths[key] = values;
      rows.forEach(
        (row, i) => (row.values[key].textContent = percent.format(values[i]))
      );
    }
    rows.forEach((row, i) => {
      row.trust.input.disabled = row.bonus.input.disabled =
        !s.weights && !s.base;
      row.trust.input.value = s.trust[i];
      row.trust.value.textContent = s.trust[i] + '%';
      row.bonus.input.value = s.bonus[i];
      row.bonus.value.textContent =
        (s.bonus[i] > 0 ? '+' : '') + s.bonus[i] + ' p.p.';
    });
    $('resetTeams').disabled =
      s.trust.every((n) => n === 100) && s.bonus.every((n) => n === 0);
    applyOrder(keepTeamInPlace);
    if (openTeam !== null) renderGame(openTeam);
  }
  const renderMixer = bindMixer(current, (editing) => {
    render();
    onEdit(editing);
  });
  formatControl.onchange = () => render();
  $('resetTeams').onclick = () => {
    const { trust, bonus } = newDraft();
    Object.assign(current(), { trust, bonus });
    render();
    onEdit(false);
  };
  $('resetModel').onclick = () => {
    const s = current(),
      { weights, trust, bonus } = newDraft();
    delete s.base;
    delete s.weight;
    delete s.description;
    Object.assign(s, { weights, trust, bonus });
    render();
    onEdit(false);
  };
  return {
    render,
    setSchedule(data) {
      feed = data;
      records = data.locks ? progress(data.locks).teams : null;
      if (openTeam !== null) renderGame(openTeam);
    },
  };
}
