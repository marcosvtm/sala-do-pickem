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
// The same calculation recovers the opening CT from the CT observed in a given round.
export function ctAtRound(a, b, startingCT, round) {
  if ((startingCT !== a && startingCT !== b) || startingCT == null ||
      !Number.isInteger(round) || round < 1) return null;
  // MR3 keeps the previous side when an overtime starts and swaps after its third round.
  const overtimePhase = (round - 25) % 12;
  const openingSides = round <= 12 || (round >= 25 && overtimePhase >= 3 && overtimePhase < 9);
  return openingSides ? startingCT : (startingCT === a ? b : a);
}
export function currentCT(game) {
  const map = game.map;
  if (!map?.score) return null;
  const rounds = map.score[0] + map.score[1];
  const low = Math.min(...map.score);
  const target = low < 12 ? 13 : 16 + 3 * Math.floor((low - 12) / 3);
  const round = Math.max(...map.score) >= target ? rounds : rounds + 1;
  if (map.sideRound === round && [game.a, game.b].includes(map.currentCT)) return map.currentCT;
  return ctAtRound(game.a, game.b, map.startingCT, round);
}
// Legacy snapshots only exposed the last map and the names of completed maps.
export function seriesMaps(game) {
  if (Array.isArray(game.maps)) return game.maps;
  const completed = game.series?.reduce((a, b) => a + b, 0) ?? 0;
  const decided = game.series?.some((count) => count > game.bo / 2);
  return Array.from({ length: game.bo }, (_, i) => {
    const last = game.status === 'end' && i === completed - 1;
    const current = game.status === 'live' && !decided && i === completed;
    const map = last || current ? game.map : null;
    let status = 'upcoming';
    if (i < completed) status = 'end';
    else if (decided) status = 'unplayed';
    else if (current && map?.score) status = 'live';
    return { status, name: map?.name ?? game.completedMaps?.[i] ?? null, score: map?.score ?? null };
  });
}
export function seriesPhase(game, maps) {
  if (game.status !== 'live' || game.bo === 1) return game.status;
  if (game.series?.some((count) => count > game.bo / 2)) return 'confirming';
  if (maps.some((map) => map.status === 'live')) return 'live';
  if (maps.some((map) => map.status === 'end')) return 'interval';
  return 'live';
}
export function agendaScore(game, maps = game.bo > 1 ? seriesMaps(game) : [], phase = seriesPhase(game, maps)) {
  if (phase === 'upcoming') return null;
  if (game.bo === 1) return game.map?.score ?? (phase === 'end' ? game.series : null);
  if (phase === 'live') return maps.find((map) => map.status === 'live')?.score ?? null;
  return game.series ?? null;
}
export function seriesStakes(game, games) {
  if (game.round === 5) return 'Classificação ou eliminação';
  if (game.bo === 1 || game.round < 3 || game.a == null) return '';
  let wins = 0, losses = 0;
  for (const previous of games) {
    if (previous.round >= game.round || previous.status !== 'end' || !previous.series) continue;
    const [a, b] = previous.series;
    if (a === b || (previous.a !== game.a && previous.b !== game.a)) continue;
    if ((a > b ? previous.a : previous.b) === game.a) wins++;
    else losses++;
  }
  if (wins === 2) return 'Classificação';
  if (losses === 2) return 'Eliminação';
  return '';
}
function inlineBoard(game, teams, score, phase) {
  const ct = phase === 'live' ? currentCT(game) : null;
  const board = el('strong', 'live-map-score');
  const labels = [game.a, game.b].map((id, i) => {
    const side = ct != null ? (id === ct ? 'CT' : 'TR') : '';
    const value = el('b', '', score[i]);
    if (side) value.dataset.side = side;
    const winner = phase === 'end' && score[i] > score[1 - i];
    if (winner) value.className = 'winning-score';
    if (i) board.append(el('small', '', '×'));
    board.append(value);
    return teams[id].name + ' ' + score[i] + (side ? ' (' + side + ')' : '') + (winner ? ' (vencedor)' : '');
  });
  const unit = game.bo > 1 && phase !== 'live' ? ' em mapas' : ' em rounds';
  board.title = labels.join(' × ');
  board.setAttribute('role', 'img');
  board.setAttribute('aria-label', 'Placar' + unit + ': ' + board.title);
  return board;
}
function mapName(name) {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : '';
}
function matchNotes(game, games, maps, phase) {
  const notes = ['R' + game.round, 'MD' + game.bo, seriesStakes(game, games)];
  if (game.bo > 1) {
    if (phase === 'live') {
      const current = maps.findIndex((map) => map.status === 'live');
      if (current >= 0) notes.push('Mapa ' + (current + 1), mapName(maps[current].name));
      if (game.series) notes.push('Série ' + game.series.join('–') + ' em mapas');
    } else if (phase === 'interval') {
      const next = maps.find((map) => map.status === 'upcoming');
      notes.push('Em mapas', next?.name ? mapName(next.name) + ' a seguir' : 'Aguardando próximo mapa');
    } else if (phase === 'confirming') notes.push('Em mapas', 'Aguardando confirmação');
    else if (phase === 'end') notes.push('Final em mapas');
  } else if (game.map) notes.push(mapName(game.map.name));
  if (phase === 'live') {
    if (!agendaScore(game, maps, phase)) notes.push('Aguardando placar');
    else {
      if (delayedScore(game)) notes.push('Último placar disponível');
      const reported = game.map?.reportedAt;
      notes.push((game.map?.source ?? (reported ? 'DRAFT5' : 'PGL')) + (reported ? ' ' + scoreTime.format(reported) : ''));
      if (currentCT(game) == null) notes.push('Aguardando lados CT/TR');
    }
  }
  return notes.filter(Boolean).join(' · ');
}
function mapTable(game, teams, maps) {
  const table = el('table', 'agenda-maps');
  const pair = [teams[game.a], teams[game.b]];
  const matchup = pair.every(Boolean) ? ' de ' + pair.map((team) => team.name).join(' e ') : '';
  table.setAttribute('aria-label', 'Rounds por mapa' + matchup);
  const header = table.createTHead().insertRow();
  for (const label of ['Mapa', pair[0]?.short ?? 'A', pair[1]?.short ?? 'B', 'Situação']) {
    const cell = el('th', '', label);
    cell.scope = 'col';
    header.append(cell);
  }
  for (const [i, team] of pair.entries()) {
    if (team) header.cells[i + 1].setAttribute('aria-label', team.name);
  }
  const body = table.createTBody();
  maps.forEach((map, i) => {
    const row = body.insertRow();
    const name = mapName(map.name);
    const title = el('th', '', name ? (i + 1) + ' · ' + name : 'Mapa ' + (i + 1));
    if (!name && map.status === 'upcoming') title.append(' · A definir');
    title.scope = 'row';
    row.append(title);
    const ct = map.status === 'live' ? currentCT(game) : null;
    let winner = null;
    for (const [j, id] of [game.a, game.b].entries()) {
      const value = row.insertCell();
      value.textContent = map.score?.[j] ?? '—';
      if (map.score && ct != null) {
        const side = id === ct ? 'CT' : 'TR';
        value.dataset.side = side;
        value.setAttribute('aria-label', map.score[j] + ' rounds, ' + side);
      }
      if (map.status === 'end' && map.score && map.score[j] > map.score[1 - j]) {
        value.className = 'winning-score';
        winner = pair[j];
      }
    }
    let label = 'Aguardando';
    if (map.status === 'live') label = 'Ao vivo';
    else if (map.status === 'unplayed') label = 'Não disputado';
    else if (map.status === 'end') label = winner ? winner.short + ' venceu' : 'Encerrado';
    else if (i === game.bo - 1) {
      const tiedBeforeLast = game.series?.every((n) => n === (game.bo - 1) / 2);
      label = tiedBeforeLast ? 'A seguir' : 'Desempate se necessário';
    }
    const status = row.insertCell();
    status.textContent = label;
    if (map.status === 'live') status.className = 'live';
  });
  return table;
}

function renderGame(game, games, teams, base, stale, expanded) {
  const row = el('div', 'agenda-row');
  const maps = game.bo > 1 ? seriesMaps(game) : [];
  const phase = seriesPhase(game, maps);
  const timing = el('div', 'game-time');
  const live = game.status === 'live';
  let when = time.format(game.at);
  if (phase === 'end') when = 'Encerrado';
  else if (phase === 'interval') when = 'Intervalo';
  else if (live) when = stale ? 'Última leitura' : 'Ao vivo';
  timing.append(el(phase === 'end' ? 'span' : 'b', live ? 'live' : '', when), el('small', '', day.format(game.at)));
  const score = agendaScore(game, maps, phase);
  const names = el('div', 'scheduled-teams' + (score ? ' has-score' : ''));
  if (game.a == null || game.b == null) names.append(el('strong', '', 'Adversários a definir'));
  else {
    for (const [i, id] of [game.a, game.b].entries()) {
      if (i) names.append(score ? inlineBoard(game, teams, score, phase) : el('small', '', '×'));
      const lost = phase === 'end' && score && score[i] < score[1 - i];
      const name = el('span', lost ? 'losing-team' : '', teams[id].name);
      const img = new Image();
      img.alt = '';
      img.src = '/assets/' + teams[id].logo;
      name.prepend(img);
      names.append(name);
    }
  }
  const info = el('div', 'scheduled-info');
  info.append(names, el('small', '', matchNotes(game, games, maps, phase)));
  const actions = el('div', 'agenda-actions');
  row.append(timing, info, actions);
  const key = game.round + '-' + game.slot;
  row.dataset.series = key;
  if (game.bo > 1) {
    const toggle = el('button', 'map-toggle');
    toggle.type = 'button';
    toggle.id = 'maps-toggle-' + key;
    const panel = el('div', 'map-history');
    panel.id = 'maps-' + key;
    toggle.setAttribute('aria-controls', panel.id);
    const matchup = game.a != null && game.b != null
      ? teams[game.a].name + ' e ' + teams[game.b].name
      : 'partida ' + game.slot + ' da rodada ' + game.round;
    const show = (open) => {
      toggle.textContent = open ? 'Ocultar mapas' : 'Ver mapas';
      toggle.setAttribute('aria-label', toggle.textContent + ' · ' + matchup);
      toggle.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (open && !panel.firstChild) panel.append(mapTable(game, teams, maps));
    };
    show(expanded.has(key));
    toggle.onclick = () => {
      if (panel.hidden) expanded.add(key);
      else expanded.delete(key);
      show(expanded.has(key));
    };
    actions.append(toggle);
    row.append(panel);
  }
  const href = matchLink(game, base);
  if (href) {
    const link = el('a', 'match-link', 'HLTV');
    link.id = 'agenda-link-' + key;
    link.href = href;
    link.setAttribute('aria-label', 'Partida ' + game.slot + ' da rodada ' + game.round + ' na HLTV');
    actions.append(link);
  }
  return row;
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
  const expanded = new Set();
  const roundPicker = $('agendaRound');
  const list = $('agendaGames');
  let lastStale = true;
  let previousRound = 0;
  roundPicker.onchange = () => renderAgenda(latestGames ?? [], lastStale, lastChecked);
  function renderAgenda(games, stale, checked) {
    const current = currentGames(games);
    const activeRound = current[0] && Math.min(...current.map((game) => game.round));
    const reading = list.contains(document.activeElement) || list.querySelector('[aria-expanded="true"]');
    if (!roundPicker.value && previousRound && activeRound !== previousRound && reading) {
      roundPicker.value = String(previousRound);
    }
    previousRound = activeRound;
    const selected = Number(roundPicker.value);
    const rows = selected ? games.filter((game) => game.round === selected) : current;
    const round = selected || activeRound;
    $('agendaStatus').textContent =
      (round ? 'Rodada ' + round + ' · ' : '') + 'Horários de Cuiabá' +
      (stale ? ' · Agenda da última leitura disponível' : ' · Consulta a cada 15 s') +
      (checked ? ' · PGL ' + day.format(checked) + ' às ' + time.format(checked) : ' · Programação publicada');
    const sig = JSON.stringify([rows, stale, Boolean(base), rows.map((game) => [delayedScore(game), seriesStakes(game, games)])]);
    if (sig === signature) return;
    signature = sig;
    const focusId = list.contains(document.activeElement) ? document.activeElement.id : '';
    const anchor = Array.from(list.querySelectorAll('.agenda-row')).find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && (node.matches(':focus-within') || node.querySelector('[aria-expanded="true"]'));
    });
    const offset = anchor?.getBoundingClientRect().top;
    const view = rows.map((game) => renderGame(game, games, stage.teams, base, stale, expanded));
    list.replaceChildren(...view);
    if (focusId) $(focusId)?.focus({ preventScroll: true });
    const updated = anchor && view.find((node) => node.dataset.series === anchor.dataset.series);
    if (updated) window.scrollBy(0, updated.getBoundingClientRect().top - offset);
  }
  function paint(games, stale, checked) {
    latestGames = games;
    lastStale = stale;
    lastChecked = checked;
    onSchedule?.({ games, stale, base, locks: confirmedLocks });
    renderAgenda(games, stale, checked);
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
