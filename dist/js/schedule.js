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
  const round = Math.min(...pending.map((g) => g.round));
  return pending
    .filter((g) => g.round === round || g.status === 'live')
    .sort(
      (a, b) =>
        Number(b.status === 'live') - Number(a.status === 'live') ||
        a.at - b.at ||
        a.slot - b.slot
    );
}
export async function bindFeed(stage, applyOfficial) {
  const localKey = 'official:' + stage.id;
  let lastOfficial,
    base,
    signature,
    busy = false;
  function apply(locks) {
    if (
      !Array.isArray(locks) ||
      locks.length !== 33 ||
      !locks.every((v) => [-1, 0, 1].includes(v))
    )
      return;
    const sig = locks.join(',');
    if (sig === lastOfficial) return;
    lastOfficial = sig;
    applyOfficial(locks);
  }
  try {
    apply(JSON.parse(localStorage.getItem(localKey)));
  } catch {}
  function paint(games, stale, checked) {
    const rows = currentGames(games),
      sig = JSON.stringify([rows, stale, Boolean(base)]);
    $('agendaStatus').textContent =
      (rows.length
        ? 'Rodada ' + Math.min(...rows.map((g) => g.round)) + ' · '
        : 'Stage 1 encerrado · ') +
      'Horários de Cuiabá' +
      (stale
        ? ' · Agenda da última leitura disponível'
        : ' · Consulta a cada minuto') +
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
          live ? (stale ? 'Em jogo*' : 'Ao vivo') : time.format(g.at)
        ),
        el('small', '', day.format(g.at))
      );
      const names = el('div', 'scheduled-teams');
      if (g.a === null || g.b === null)
        names.append(el('strong', '', 'Adversários a definir'));
      else
        for (const [i, id] of [g.a, g.b].entries()) {
          if (i) names.append(el('small', '', '×'));
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
      const score =
        live && g.map ? ' · ' + g.map.name + ' ' + g.map.score.join('–') : '';
      info.append(
        el(
          'small',
          '',
          'R' +
            g.round +
            ' · MD' +
            g.bo +
            (live && g.bo > 1 && g.series
              ? ' · Mapas ' + g.series.join('–')
              : '') +
            score
        )
      );
      row.append(timing, info);
      if (base) {
        const opening = base.games.find(
          (m) =>
            m.round === 1 &&
            g.round === 1 &&
            ((m.a === g.a && m.b === g.b) || (m.a === g.b && m.b === g.a))
        );
        const slot = opening?.slot ?? g.slot;
        const link = el('a', 'match-link', 'HLTV');
        link.href = base.links[ROUND_START[g.round - 1] + slot - 1];
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
        : 'Fonte: PGL · Resultados oficiais atualizados a cada minuto.';
    } catch {
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
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });
}
