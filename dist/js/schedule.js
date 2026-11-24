import { ROUND_START } from './swiss.js';
export const SCORE_POLL_MS = 15000;
const $ = (id) => document.getElementById(id);
const time = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'America/Cuiaba',
});
const scoreTime = new Intl.DateTimeFormat('pt-BR', {
  timeStyle: 'medium', timeZone: 'America/Cuiaba',
});
const delayedScore = (g) => g.status === 'live' && g.map?.reportedAt > 0 &&
  Date.now() - g.map.reportedAt > 180000;
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
export function currentCT(game) {
  const map = game.map;
  if (!map?.score) return null;
  const rounds = map.score[0] + map.score[1];
  const teams = [game.a, game.b];
  if (rounds < 24 && Math.max(...map.score) < 13 && teams.includes(map.startingCT))
    return rounds < 12 ? map.startingCT : teams.find((id) => id !== map.startingCT);
  return map.sideRound === rounds + 1 && teams.includes(map.currentCT) ? map.currentCT : null;
}
export function agendaScore(game) {
  if (game.status === 'live') return game.map?.score ?? null;
  if (game.status !== 'end') return null;
  return game.bo === 1 ? game.map?.score ?? game.series : game.series;
}
function inlineBoard(game, teams, score, stale) {
  const final = game.status === 'end';
  const ct = !final && !stale ? currentCT(game) : null;
  const board = el('strong', 'live-map-score');
  const labels = [game.a, game.b].map((id, i) => {
    const side = ct != null ? (id === ct ? 'CT' : 'TR') : '';
    const value = el('b', '', score[i]);
    if (side) value.dataset.side = side;
    const winner = final && score[i] > score[1 - i];
    if (winner) value.className = 'winning-score';
    if (i) board.append(el('small', '', '×'));
    board.append(value);
    return teams[id].name + ' ' + score[i] + (side ? ' (' + side + ')' : '') + (winner ? ' (vencedor)' : '');
  });
  board.title = labels.join(' × ');
  board.setAttribute('role', 'img');
  board.setAttribute('aria-label', (final ? 'Placar final: ' : 'Placar do mapa: ') + board.title);
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
      sig = JSON.stringify([rows, stale, Boolean(base), rows.map((g) => delayedScore(g))]);
    $('agendaStatus').textContent =
      (rows.some((g) => g.status !== 'end')
        ? 'Rodada ' + Math.min(...rows.map((g) => g.round)) + ' · '
        : 'Stage 1 encerrado · ') +
      'Horários de Cuiabá' +
      (stale
        ? ' · Agenda da última leitura disponível'
        : ' · Consulta a cada 15 s') +
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
          g.status === 'end' ? 'span' : 'b',
          live ? 'live' : '',
          live ? (stale ? 'Última leitura' : 'Ao vivo') : g.status === 'end' ? 'Encerrado' : time.format(g.at)
        ),
        el('small', '', day.format(g.at))
      );
      const inlineScore = g.a !== null && g.b !== null ? agendaScore(g) : null;
      const names = el('div', 'scheduled-teams' + (inlineScore ? ' has-score' : ''));
      if (g.a === null || g.b === null)
        names.append(el('strong', '', 'Adversários a definir'));
      else
        for (const [i, id] of [g.a, g.b].entries()) {
          if (i) names.append(inlineScore ? inlineBoard(g, stage.teams, inlineScore, stale) : el('small', '', '×'));
          const lost = g.status === 'end' && inlineScore && inlineScore[i] < inlineScore[1 - i];
          const team = stage.teams[id],
            span = el('span', lost ? 'losing-team' : '', team.name),
            img = new Image();
          img.alt = '';
          img.src = '/assets/' + team.logo;
          span.prepend(img);
          names.append(span);
        }
      const info = el('div', 'scheduled-info');
      info.append(names);
      let score = g.map && (live || g.bo === 1) ? ' · ' + g.map.name[0].toUpperCase() + g.map.name.slice(1) : '';
      if (live && !g.map?.score) score += ' · Aguardando placar';
      if (live && g.map?.score) {
        const reported = g.map.reportedAt;
        score += ' · ' + (delayedScore(g) ? 'Último placar disponível · ' : '') +
          (g.map.source ?? (reported ? 'DRAFT5' : 'PGL'));
        if (reported) score += ' ' + scoreTime.format(reported);
      }
      info.append(
        el(
          'small',
          '',
          'R' +
            g.round +
            ' · MD' +
            g.bo +
            (g.series && live && g.bo > 1
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
        : 'Fonte: PGL · Consulta a cada 15 s.';
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
  }, SCORE_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
}
