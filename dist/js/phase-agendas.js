import { currentGames, renderGame, SCORE_POLL_MS } from './schedule.js';

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
  const rounds = element('select');
  rounds.setAttribute('aria-label', 'Rodada da ' + title);
  rounds.hidden = true;
  const list = element('div');
  const retry = element('button', 'Tentar novamente');
  retry.className = 'outline';
  retry.hidden = true;
  panel.append(status, rounds, list, retry);
  let busy = false, loaded = false, timer, chosen, signature;
  let nextPoll = SCORE_POLL_MS;
  const visible = () => panel.isConnected && (expanded || panel.open) && !document.hidden;
  const pollLater = () => {
    clearTimeout(timer);
    if (visible() && !completed) timer = setTimeout(() => { if (visible()) load(); }, nextPoll);
  };
  const openMaps = new Set();
  async function load() {
    if (busy) return;
    busy = true;
    retry.hidden = true;
    if (!loaded) status.textContent = 'Consultando a agenda…';
    try {
      const feed = await get('/api/results?stage=' + phase.id);
      let roster, base;
      if (Array.isArray(feed.teams)) {
        roster = { teams: feed.teams };
      } else if (!feed.preview) {
        roster = await get(phase.rosterUrl);
        if (roster?.id !== phase.id) throw Error();
        base = phase.scheduleUrl === phase.rosterUrl ? roster : await get(phase.scheduleUrl);
      }
      const games = feed.schedule;
      if (!Array.isArray(games) || !games.length) throw Error();
      const ids = [...new Set(games.map(game => game.round))].sort((a, b) => a - b);
      nextPoll = games.some(g => g.status === 'live' || (g.status !== 'end' && Math.abs(Date.now() - g.at) <= 6 * 3600000))
        ? SCORE_POLL_MS : 30 * 60000;
      const pickRound = chosen && ids.includes(chosen) ? chosen : currentGames(games)[0].round;
      const roundLabel = n => games.find(game => game.round === n)?.roundLabel || 'Rodada ' + n;
      if (!loaded || [...rounds.options].map(o => o.text).join('|') !== ids.map(roundLabel).join('|'))
        rounds.replaceChildren(...ids.map(n => new Option(roundLabel(n), n)));
      rounds.value = String(pickRound);
      rounds.hidden = false;
      status.textContent = feed.preview
        ? 'Horários de Cuiabá · Programação prevista pela PGL · Adversários a definir.'
        : 'Horários de Cuiabá' + (completed ? ' · Resultados da fase encerrada.' :
          feed.scheduleChecked ? ' · Agenda consultada ' + stamp.format(feed.scheduleChecked) : ' · Programação publicada pela PGL.');
      function view() {
        const round = games.filter(game => game.round === Number(rounds.value));
        const sig = JSON.stringify([round, roster?.teams, feed.stale]);
        if (signature === sig) return;
        signature = sig;
        const focus = list.contains(document.activeElement) ? document.activeElement.id : null;
        list.replaceChildren();
        if (feed.preview || round.every(game => game.a == null && game.b == null)) previews(list, round);
        else for (const game of round)
          list.append(renderGame(game, games, roster.teams, base, feed.stale, openMaps, phase.key + '-'));
        if (focus) list.querySelector('#' + CSS.escape(focus))?.focus({ preventScroll: true });
      }
      rounds.onchange = () => { chosen = Number(rounds.value); view(); };
      view();
      loaded = true;
    } catch {
      status.textContent = loaded ? 'PGL indisponível. Exibindo a última agenda recebida.' : 'A agenda está indisponível.';
      retry.hidden = false;
    } finally { busy = false; pollLater(); }
  }
  retry.onclick = load;
  if (expanded) load();
  else panel.ontoggle = () => { clearTimeout(timer); if (panel.open) load(); };
  document.addEventListener('visibilitychange', () => { if (visible()) load(); });
  return panel;
}
