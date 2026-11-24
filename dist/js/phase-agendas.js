import { currentGames, renderGame } from './schedule.js';

const stamp = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

async function get(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw Error();
  return response.json();
}

function element(tag, text) {
  const n = document.createElement(tag);
  if (text) n.textContent = text;
  return n;
}

function previews(list, games) {
  const times = new Map();
  for (const game of games) {
    const key = game.at + '-' + game.bo;
    const group = times.get(key) ?? { ...game, count: 0 };
    group.count++;
    times.set(key, group);
  }
  for (const group of times.values()) {
    const row = element('div');
    row.className = 'phase-timeslot';
    row.append(element('b', stamp.format(group.at)), element('span',
      group.count + (group.count === 1 ? ' série' : ' séries') + ' · MD' + group.bo));
    list.append(row);
  }
}

export function phaseAgenda(phase, { expanded = false, completed = false } = {}) {
  const panel = element(expanded ? 'section' : 'details');
  panel.className = 'panel phase-agenda';
  const title = 'Agenda ' + (phase.key === 'playoffs' ? 'dos ' : 'do ') + phase.name;
  panel.append(element(expanded ? 'h2' : 'summary', title + (completed ? ' · Histórico' : '')));
  const status = element('p');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  if (phase.key === 'stage-3' || phase.key === 'playoffs') {
    status.textContent = phase.format === 'bracket' ? 'Aguardando a chave oficial dos playoffs.'
      : 'Os horários e os confrontos desta fase aparecerão aqui.';
    panel.append(status);
    return panel;
  }
  const rounds = element('select');
  rounds.setAttribute('aria-label', 'Rodada da ' + title);
  rounds.hidden = true;
  const list = element('div');
  const retry = element('button', 'Tentar novamente');
  retry.className = 'outline';
  retry.hidden = true;
  panel.append(status, rounds, list, retry);
  let busy = false, loaded = false;
  const openMaps = new Set();
  async function load() {
    if (busy || loaded) return;
    busy = true;
    retry.hidden = true;
    status.textContent = 'Consultando a agenda…';
    try {
      const feed = await get('/api/results?stage=' + phase.id);
      let roster, base;
      if (!feed.preview) {
        roster = await get(phase.rosterUrl);
        if (roster?.id !== phase.id) throw Error();
        base = phase.scheduleUrl === phase.rosterUrl ? roster : await get(phase.scheduleUrl);
      }
      const games = feed.schedule;
      if (!Array.isArray(games) || !games.length) throw Error();
      const ids = [...new Set(games.map(game => game.round))].sort((a, b) => a - b);
      rounds.replaceChildren(...ids.map(n => new Option('Rodada ' + n, n)));
      rounds.value = String(currentGames(games)[0].round);
      rounds.hidden = false;
      status.textContent = feed.preview
        ? 'Horários de Cuiabá · Programação prevista pela PGL · Adversários a definir.'
        : 'Horários de Cuiabá' + (completed ? ' · Resultados da fase encerrada.' : ' · Última leitura da PGL.');
      const view = () => {
        list.replaceChildren();
        const round = games.filter(game => game.round === Number(rounds.value));
        if (feed.preview) previews(list, round);
        else for (const game of round)
          list.append(renderGame(game, games, roster.teams, base, feed.stale, openMaps, phase.key + '-'));
      };
      rounds.onchange = view;
      view();
      loaded = true;
    } catch {
      status.textContent = 'A agenda está indisponível.';
      retry.hidden = false;
    } finally { busy = false; }
  }
  retry.onclick = load;
  if (expanded) load();
  else panel.ontoggle = () => { if (panel.open) load(); };
  return panel;
}
