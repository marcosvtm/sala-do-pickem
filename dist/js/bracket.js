import { tournament, ROUND_START } from './swiss.js';
import { updateLock } from './state.js';
import { matchLink } from './schedule.js';

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
    const key = [round, Math.min(a, b), Math.max(a, b)].join('/');
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
  const previews = new Map();
  const liveLinks = new Map();
  let official = Array(33).fill(-1),
    projection,
    previousTap;
  function logo(id) {
    const img = new Image();
    img.src = '/assets/' + teams[id].logo;
    img.alt = '';
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
        const s = el('span', '', t.short);
        s.title = t.name;
        s.prepend(logo(id));
        icons.append(s);
      }
    });
    box.append(icons);
    return box;
  }
  function updateLiveLink(fixture, g) {
    const href = liveLinks.get(g.key + '/' + g.bo);
    const center = fixture.children[1];
    fixture.classList.toggle('is-live', Boolean(href));
    if (href) {
      if (center.getAttribute('href') === href) return;
      const link = el('a', 'fixture-live', 'AO VIVO');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = teams[g.a].name + ' × ' + teams[g.b].name + ' ao vivo na HLTV (nova aba)';
      link.setAttribute('aria-label', link.title);
      center.replaceWith(link);
    } else if (center.tagName === 'A') {
      center.replaceWith(el('small', 'fixture-format', 'MD' + g.bo));
    }
  }
  function setSchedule({ games, stale, base }) {
    liveLinks.clear();
    if (!stale) for (const game of games) {
      if (game.status !== 'live' || game.a == null || game.b == null) continue;
      const href = matchLink(game, base);
      if (href) liveLinks.set([game.round - 1, Math.min(game.a, game.b), Math.max(game.a, game.b), game.bo].join('/'), href);
    }
    for (const fixture of grid.querySelectorAll('.fixture')) {
      updateLiveLink(fixture, projection.games[Number(fixture.dataset.index)]);
    }
  }
  function draw() {
    const locks = getLocks();
    projection = project(locks, official, previews);
    const columns = [];
    for (let r = 0; r <= 5; r++) {
      const col = el('section', 'round'),
        stack = el('div', 'round-stack');
      col.append(
        el('h3', '', r === 5 ? 'Resultados finais' : 'Rodada ' + (r + 1)),
        stack
      );
      if (r >= 3) stack.append(pool(3, r - 3));
      for (const g of projection.games.filter((g) => g.round === r)) {
        const game = el('div', 'fixture ' + g.source);
        game.dataset.index = g.i;
        for (const [side, id] of [g.a, g.b].entries()) {
          if (side) game.append(el('small', 'fixture-format', 'MD' + g.bo));
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
          btn.append(logo(id), el('span', '', teams[id].short));
          game.append(btn);
        }
        updateLiveLink(game, g);
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
  return { setOfficial, setSchedule };
}
