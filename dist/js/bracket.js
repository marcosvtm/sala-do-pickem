import { tournament, ROUND_START } from './swiss.js';
import { updateLock } from './state.js';
import { matchLink } from './schedule.js';

const pairingKey = (round, a, b) => [round, Math.min(a, b), Math.max(a, b)].join('/');
const kickoffTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
});
const bracketMarks = {
  'gosh.svg': 'gosh-mark.svg',
  '100_thieves.svg': '100_thieves.svg#_100_THIEVES',
};

export function kickoffCountdown(at, now) {
  const total = Math.max(0, Math.ceil((at - now) / 1000));
  const two = (n) => String(n).padStart(2, '0');
  const minutes = two(Math.floor(total / 60) % 60);
  const seconds = two(total % 60);
  return (total >= 3600 ? two(Math.floor(total / 3600)) + ':' : '') + minutes + ':' + seconds;
}

export function mergeOfficial(locks, official) {
  const merged = [...locks];
  for (let r = 0; r < 5; r++) {
    const start = ROUND_START[r],
      end = ROUND_START[r + 1] ?? 33;
    for (let i = start; i < end; i++) {
      if (official[i] < 0) continue;
      if (merged[i] >= 0 && merged[i] !== official[i]) merged.fill(-1, end);
      merged[i] = official[i];
    }
  }
  return merged;
}

export function project(locks, official, previews) {
  const games = [],
    wins = Array(16).fill(0),
    losses = Array(16).fill(0);
  tournament((a, b, bo, i, round) => {
    const key = pairingKey(round, a, b);
    const picked = previews.get(key);
    const source =
      official[i] >= 0
        ? 'official'
        : locks[i] >= 0
          ? 'locked'
          : picked !== undefined
            ? 'preview'
            : 'seed';
    const side =
      official[i] >= 0
        ? official[i]
        : locks[i] >= 0
          ? locks[i]
          : picked !== undefined
            ? Number(picked === b)
            : Number(a > b);
    games.push({ a, b, bo, i, round, key, source, side });
    wins[side ? b : a]++;
    losses[side ? a : b]++;
    return !side;
  });
  return { games, wins, losses };
}

export function fixProjected(locks, official, games, game, side) {
  if (official[game.i] >= 0) return;
  for (const prior of games.slice(0, ROUND_START[game.round]))
    locks[prior.i] = prior.side;
  updateLock({ locks }, game.round, game.i, locks[game.i] === side ? -1 : side);
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const labels = {
  seed: 'Projeção por seed',
  preview: 'Escolha provisória',
  locked: 'Fixado',
  official: 'Oficial',
};
export function bindBracket(teams, getLocks, onChange) {
  const grid = document.getElementById('matches');
  const scroll = grid.parentElement;
  const jumps = document.getElementById('roundJumps');
  for (let i = 0; i <= 5; i++) {
    const button = el('button', 'outline', i === 5 ? 'Final' : 'R' + (i + 1));
    button.type = 'button';
    button.setAttribute('aria-label', i === 5 ? 'Resultados finais' : 'Rodada ' + (i + 1));
    button.setAttribute('aria-controls', 'bracket-round-' + i);
    button.onclick = () => {
      const col = grid.children[i];
      const offset = col.getBoundingClientRect().left - grid.getBoundingClientRect().left;
      scroll.scrollTo({ left: offset, behavior: 'instant' });
      for (const jump of jumps.children) jump.setAttribute('aria-pressed', String(jump === button));
      button.focus({ preventScroll: true });
    };
    jumps.append(button);
  }
  const previews = new Map();
  const schedule = new Map();
  let official = Array(33).fill(-1),
    projection,
    previousTap;
  function logo(id, alt = '') {
    const img = new Image();
    const file = teams[id].logo;
    img.src = '/assets/' + (bracketMarks[file] ?? file);
    img.alt = alt;
    return img;
  }
  function pool(w, l) {
    const box = el('div', 'pool ' + (w === 3 ? 'advanced' : 'out'));
    const title = el('div', 'pool-title', w === 3 ? 'Avança' : 'Eliminado');
    title.append(el('b', '', w + '–' + l));
    box.append(title);
    const icons = el('div', 'pool-teams');
    teams.forEach((t, id) => {
      if (projection.wins[id] === w && projection.losses[id] === l) {
        const img = logo(id, t.name);
        img.title = t.name;
        icons.append(img);
      }
    });
    box.append(icons);
    return box;
  }
  function updateCenter(fixture, g) {
    const game = schedule.get(g.key + '/' + g.bo);
    const center = fixture.children[1];
    const live = game?.status === 'live' && !game.stale && g.source !== 'official';
    fixture.classList.toggle('is-live', live);
    if (live) {
      if (center.classList.contains('fixture-live') && center.getAttribute('href') === game.href) return;
      const badge = el(game.href ? 'a' : 'span', 'fixture-live', 'LIVE');
      badge.title = teams[g.a].name + ' × ' + teams[g.b].name + ' ao vivo';
      if (game.href) {
        badge.href = game.href;
        badge.target = '_blank';
        badge.rel = 'noopener noreferrer';
        badge.title += ' na HLTV (nova aba)';
      }
      badge.setAttribute('aria-label', badge.title);
      center.replaceWith(badge);
    } else if (game?.status === 'upcoming' && Number.isFinite(game.at) && g.source !== 'official') {
      if (center.dataset.kickoff === String(game.at)) return;
      const clock = el('time', 'fixture-clock', kickoffCountdown(game.at, Date.now()));
      clock.dateTime = new Date(game.at).toISOString();
      clock.dataset.kickoff = game.at;
      clock.title = 'Início previsto em ' + kickoffTime.format(game.at) + ' (Cuiabá) · MD' + g.bo;
      center.replaceWith(clock);
    } else {
      const ended = game?.status === 'end' || g.source === 'official';
      const text = ended ? 'FIM' : 'vs';
      if (center.className === 'fixture-status' && center.textContent === text) return;
      const status = el('small', 'fixture-status', text);
      status.title = (ended ? 'Encerrado' : 'Aguardando confirmação da agenda') + ' · MD' + g.bo;
      center.replaceWith(status);
    }
  }
  function setSchedule({ games, stale, base }) {
    schedule.clear();
    for (const game of games) {
      if (game.a == null || game.b == null) continue;
      schedule.set(pairingKey(game.round - 1, game.a, game.b) + '/' + game.bo, {
        status: game.status, at: game.at, stale, href: matchLink(game, base) ?? null,
      });
    }
    for (const fixture of grid.querySelectorAll('.fixture')) {
      updateCenter(fixture, projection.games[Number(fixture.dataset.index)]);
    }
  }
  function tick() {
    if (document.hidden || !grid.getClientRects().length) return;
    const now = Date.now();
    for (const clock of grid.querySelectorAll('time[data-kickoff]')) {
      const value = kickoffCountdown(Number(clock.dataset.kickoff), now);
      if (clock.textContent !== value) clock.textContent = value;
    }
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', tick);
  function draw() {
    const locks = getLocks();
    projection = project(locks, official, previews);
    const columns = [];
    for (let r = 0; r <= 5; r++) {
      const col = el('section', 'round'),
        stack = el('div', 'round-stack');
      col.id = 'bracket-round-' + r;
      const heading = el('h3', '', r === 5 ? 'Resultados finais' : 'Rodada ' + (r + 1));
      heading.tabIndex = -1;
      col.append(heading, stack);
      if (r >= 3) stack.append(pool(3, r - 3));
      for (const g of projection.games.filter((g) => g.round === r)) {
        const game = el('div', 'fixture ' + g.source);
        game.dataset.index = g.i;
        for (const [side, id] of [g.a, g.b].entries()) {
          if (side) game.append(el('small'));
          const btn = el('button', 'team-side');
          btn.type = 'button';
          btn.dataset.match = g.i;
          btn.dataset.side = side;
          btn.title =
            teams[id].name + (g.side === side ? ' · ' + labels[g.source] : '');
          btn.setAttribute(
            'aria-label',
            'Rodada ' +
              (r + 1) +
              ', ' +
              teams[g.a].name +
              ' × ' +
              teams[g.b].name +
              ', ' +
              btn.title
          );
          btn.setAttribute('aria-pressed', String(g.side === side));
          btn.disabled = g.source === 'official';
          btn.append(logo(id));
          game.append(btn);
        }
        updateCenter(game, g);
        stack.append(game);
      }
      if (r >= 3) stack.append(pool(r - 3, 3));
      columns.push(col);
    }
    grid.replaceChildren(...columns);
    const verified = official.filter((x) => x >= 0).length,
      fixed = locks.filter((x) => x >= 0).length - verified;
    const count = verified + ' oficiais · ' + fixed + ' fixados';
    document.getElementById('locksCount').textContent = count;
    document.getElementById('homeLocks').textContent = count;
    document.getElementById('clearLocks').disabled = !fixed && !previews.size;
  }
  function act(btn, lock) {
    const g = projection.games[Number(btn.dataset.match)],
      side = Number(btn.dataset.side);
    if (g.source === 'official') return;
    if (lock) {
      fixProjected(getLocks(), official, projection.games, g, side);
      previews.delete(g.key);
      onChange();
    } else if (g.source !== 'locked') previews.set(g.key, side ? g.b : g.a);
    draw();
    grid
      .querySelector('[data-match="' + g.i + '"][data-side="' + side + '"]')
      ?.focus({ preventScroll: true });
  }
  grid.onclick = (e) => {
    const b = e.target.closest('[data-match]');
    if (!b) return;
    const key = b.dataset.match + '/' + b.dataset.side,
      now = performance.now();
    const double =
      previousTap?.key === key &&
      now - previousTap.time < 520 &&
      e.detail !== 0;
    previousTap = double ? null : { key, time: now };
    act(b, double);
  };
  grid.onkeydown = (e) => {
    if (e.shiftKey && e.key === 'Enter' && e.target.matches('[data-match]')) {
      e.preventDefault();
      previousTap = null;
      act(e.target, true);
    }
  };
  document.getElementById('clearLocks').onclick = () => {
    getLocks().splice(0, 33, ...official);
    previews.clear();
    previousTap = null;
    onChange();
    draw();
  };
  draw();
  function setOfficial(results) {
    const locks = getLocks(),
      merged = mergeOfficial(locks, results);
    official = results;
    const changed = merged.some((v, i) => v !== locks[i]);
    if (changed) {
      locks.splice(0, 33, ...merged);
      onChange();
    }
    draw();
  }
  function syncScenario() {
    previews.clear();
    previousTap = null;
    setOfficial(official);
  }
  return { setOfficial, setSchedule, syncScenario };
}
