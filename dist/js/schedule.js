import { ROUND_START } from './swiss.js';
const $ = (id) => document.getElementById(id);
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Cuiaba',
});
const day = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Cuiaba',
});
const el = (tag, cls, value) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (value !== undefined) n.textContent = value;
  return n;
};
export function currentGames(games) {
  const pending = games.filter((g) => g.status !== 'end');
  const round = pending.length ? Math.min(...pending.map((g) => g.round)) : Math.max(...games.map((g) => g.round));
  return games
    .filter((g) => g.round === round || g.status === 'live')
    .sort(
      (a, b) =>
        Number(b.status === 'live') - Number(a.status === 'live') ||
        a.at - b.at ||
        a.slot - b.slot
    );
}
export function matchLink(game, base) {
  if (!base) return null;
  const opening =
    game.round === 1 &&
    base.games.find(
      (m) =>
        m.round === 1 &&
        ((m.a === game.a && m.b === game.b) ||
          (m.a === game.b && m.b === game.a))
    );
  return base.links[
    ROUND_START[game.round - 1] + (opening?.slot ?? game.slot) - 1
  ];
}
function liveMapScore(game, teams, stale) {
  const { score, startingCT } = game.map;
  const rounds = score[0] + score[1];
  // Opening sides identify the two regulation halves. Overtime needs its own confirmation.
  const knownSides = !stale && [game.a, game.b].includes(startingCT) &&
    Math.max(...score) < 13 && rounds < 24;
  const board = el('strong', 'live-map-score');
  const labels = [game.a, game.b].map((id, i) => {
    const side = knownSides ? ((id === startingCT) === (rounds < 12) ? 'CT' : 'TR') : '';
    const value = el('b', '', score[i]);
    if (side) value.dataset.side = side;
    if (i) board.append(el('small', '', '×'));
    board.append(value);
    return teams[id].name + ' ' + score[i] + (side ? ' (' + side + ')' : '');
  });
  board.title = labels.join(' × ');
  board.setAttribute('role', 'img');
  board.setAttribute('aria-label', 'Placar do mapa: ' + board.title);
  return board;
}
export async function bindFeed(stage, applyOfficial, onSchedule) {
  const localKey = 'official:' + stage.id;
  let lastOfficial,
    base,
    signature,
    busy = false,
    confirmedLocks,
    latestGames, lastChecked;
  function apply(locks) {
    if (
      !Array.isArray(locks) ||
      locks.length !== 33 ||
      !locks.every((v) => [-1, 0, 1].includes(v))
    )
      return;
    const sig = locks.join(',');
    confirmedLocks = locks;
    if (sig === lastOfficial) return;
    lastOfficial = sig;
    applyOfficial(locks);
  }
  try {
    apply(JSON.parse(localStorage.getItem(localKey)));
  } catch {}
  function paint(games, stale, checked) {
    latestGames = games;
    lastChecked = checked;
    onSchedule?.({ games, stale, base, locks: confirmedLocks });
    const rows = currentGames(games),
      sig = JSON.stringify([rows, stale, Boolean(base)]);
    $('agendaStatus').textContent =
      (rows.some((g) => g.status !== 'end')
        ? 'Rodada ' + Math.min(...rows.map((g) => g.round)) + ' · '
        : 'Stage 1 encerrado · ') +
      'Horários de Cuiabá' +
      (stale
        ? ' · Agenda da última leitura disponível'
        : ' · Consulta a cada 30 s') +
      (checked
        ? ' · PGL ' + day.format(checked) + ' às ' + time.format(checked)
        : ' · Programação publicada');
    if (signature === sig) return;
    signature = sig;
    const view = rows.map((g) => {
      const row = el('div', 'agenda-row'),
        timing = el('div', 'game-time');
      const live = g.status === 'live';
      timing.append(
        el(
          'b',
          live ? 'live' : '',
          live ? (stale ? 'Última leitura' : 'Ao vivo') : g.status === 'end' ? 'Encerrado' : time.format(g.at)
        ),
        el('small', '', day.format(g.at))
      );
      const inlineScore = live && g.map?.score && g.a !== null && g.b !== null;
      const names = el('div', 'scheduled-teams' + (inlineScore ? ' has-score' : ''));
      if (g.a === null || g.b === null)
        names.append(el('strong', '', 'Adversários a definir'));
      else
        for (const [i, id] of [g.a, g.b].entries()) {
          if (i) names.append(inlineScore ? liveMapScore(g, stage.teams, stale) : el('small', '', '×'));
          const team = stage.teams[id],
            span = el('span', '', team.name),
            img = new Image();
          img.alt = '';
          img.src = '/assets/' + team.logo;
          span.prepend(img);
          names.append(span);
        }
      const info = el('div', 'scheduled-info');
      info.append(names);
      let score = g.map ? ' · ' + g.map.name[0].toUpperCase() + g.map.name.slice(1) : '';
      if (g.map?.score && !inlineScore) score += ' ' + g.map.score.join('–');
      if (live && !g.map?.score) score += ' · Aguardando placar';
      if (g.map?.reportedAt) score += ' · DRAFT5 ' + time.format(g.map.reportedAt);
      info.append(
        el(
          'small',
          '',
          'R' +
            g.round +
            ' · MD' +
            g.bo +
            (g.series && (g.bo > 1 || (g.status === 'end' && !g.map?.score))
              ? ' · Mapas ' + g.series.join('–')
              : '') +
            score
        )
      );
      row.append(timing, info);
      const href = matchLink(g, base);
      if (href) {
        const slot = g.slot;
        const link = el('a', 'match-link', 'HLTV');
        link.href = href;
        link.setAttribute(
          'aria-label',
          'Partida ' + slot + ' da rodada ' + g.round + ' na HLTV'
        );
        row.append(link);
      }
      return row;
    });
    $('agendaGames').replaceChildren(
      ...(view.length
        ? view
        : [el('p', '', 'Todas as partidas desta fase foram encerradas.')])
    );
  }
  try {
    const res = await fetch('/data/schedule.json');
    if (res.ok) {
      base = await res.json();
      paint(base.games, true, null);
    }
  } catch {}
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch('/api/results', { cache: 'no-store' });
      if (!res.ok) throw Error();
      const data = await res.json();
      // A concurrent first refresh may return a snapshot before any successful source read.
      if (data.checked || !lastOfficial) {
        apply(data.locks);
        if (data.checked)
          try {
            localStorage.setItem(localKey, JSON.stringify(data.locks));
          } catch {}
      }
      const stale =
        !data.scheduleChecked || Date.now() - data.scheduleChecked > 180000;
      paint(data.schedule, stale, data.scheduleChecked);
      $('feedStatus').textContent = data.stale
        ? 'PGL temporariamente indisponível. Exibindo os últimos resultados confirmados.'
        : 'Fonte: PGL · Consulta a cada 30 s.';
    } catch {
      if (latestGames) paint(latestGames, true, lastChecked);
      $('agendaStatus').textContent =
        'PGL indisponível. Exibindo a última agenda recebida · Horários de Cuiabá.';
      $('feedStatus').textContent =
        'PGL indisponível. Exibindo os últimos resultados recebidos.';
    } finally {
      busy = false;
    }
  }
  await poll();
  setInterval(() => {
    if (!document.hidden) poll();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
}
