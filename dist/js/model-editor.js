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
    fixed = {};
  const formatControl = $('strengthFormat');
  const strengthFormat = () =>
    Number(formatControl.querySelector(':checked').value);
  for (const key of ['neutral', 'vrs', 'hltv', 'study'])
    fixed[key] = makeMatrix(teams, key, current());
  let fixedVersion;
  let personal,
    strengths,
    feed,
    records,
    openTeam = null;
  function sliderEvents(input, write) {
    let dirty = false;
    input.oninput = () => {
      write(Number(input.value));
      dirty = true;
      render();
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
  list.append(...alphabetical.map((i) => rows[i].wrap));
  function render() {
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
      if (key === 'custom') strengths = values;
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
    if (openTeam !== null) renderGame(openTeam);
  }
  const renderMixer = bindMixer(current, (editing) => {
    render();
    onEdit(editing);
  });
  formatControl.onchange = render;
  $('sortStrength').onclick = () => {
    const order = [...alphabetical].sort((a, b) => strengths[b] - strengths[a]);
    list.append(...order.map((i) => rows[i].wrap));
    $('strengthOrder').textContent =
      'Ordem do último clique · MD' + strengthFormat();
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
