import checkpoint from '../research/stage2-form-checkpoint.json' with { type: 'json' };
import weekly from '../research/stage2-hltv-2026-11-23.json' with { type: 'json' };
import { SOURCE } from './results.js';

const DAY = 86400;
const WINDOW = 120 * DAY;
const valveRepo = 'ValveSoftware/counter-strike_regional_standings';
const valveApi = 'https://api.github.com/repos/' + valveRepo;
const decay = (seconds, halfLife) => 2 ** (-seconds / (halfLife * DAY));
const pairKey = (a, b) => [a, b].sort().join('/');
const playerKey = value => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

function replayTeam(base) {
  // These schedules already include all opponents in the 120 days before the Stage 1 freeze.
  const schedule = [...base.schedule];
  const external = new Map();
  for (const [at, opponent, region] of schedule) {
    if (region === 'external') external.set(opponent, at);
  }
  return { ...base, schedule, external, last: checkpoint.cutoff };
}

function exposure(team, at) {
  let total = 0;
  for (const last of team.external.values()) {
    if (at - last <= WINDOW) total += decay(at - last, 60);
  }
  return total;
}

function evidence(team, at) {
  const recent = team.schedule.filter(([last]) => at - last <= WINDOW);
  return {
    series: recent.length,
    opponents: new Set(recent.map(game => game[1])).size,
    externalOpponents: new Set(recent.filter(game => game[2] === 'external').map(game => game[1])).size,
    unknownSeries: recent.filter(game => game[2] === 'unknown').length,
  };
}

function updateStrength(field, a, b, at, bo, winner, weight) {
  const first = a[field] * decay(at - a.last, 160);
  const second = b[field] * decay(at - b.last, 160);
  const probability = 1 / (1 + Math.exp(-(first - second) / 170 * (bo === 1 ? 0.73 : 1)));
  const change = (bo === 1 ? 32 : 43) * weight * (winner - probability);
  a[field] = first + change;
  b[field] = second - change;
}

// JS counterpart of Replay.play in scripts/calibrate-form.py, using the verified historical checkpoint.
export function replayForm(games, cutoff) {
  const teams = new Map(Object.entries(checkpoint.teams).map(([id, base]) => [id, replayTeam(base)]));
  const meetings = new Map(checkpoint.meetings.map(([a, b, count]) => [pairKey(a, b), [count, checkpoint.cutoff]]));
  let previous = checkpoint.cutoff;
  if (!Number.isFinite(cutoff) || cutoff < previous) throw Error('Corte de forma fora do histórico.');
  for (const game of games) {
    const { at, bo, winA } = game;
    const a = teams.get(game.a), b = teams.get(game.b);
    if (!a || !b || a === b || ![1, 3].includes(bo) || ![0, 1].includes(winA) ||
        !Number.isFinite(at) || at <= checkpoint.cutoff || at < previous || at > cutoff)
      throw Error('A série precisa ter equipes, resultado e horário confirmados dentro do corte.');
    previous = at;
    const unknown = !a.regions.length || !b.regions.length;
    const cross = !unknown && !a.regions.some(region => b.regions.includes(region));
    const region = unknown ? 'unknown' : cross ? 'external' : 'shared';
    const regionalEvidence = cross ? 1 : 0.25 + 0.75 * Math.min(1, Math.max(exposure(a, at), exposure(b, at)) / 4);
    const pair = pairKey(a.key, b.key);
    const [count, last] = meetings.get(pair) ?? [0, at];
    const repeats = count * decay(at - last, 60);
    updateStrength('elo', a, b, at, bo, winA, 1);
    updateStrength('formElo', a, b, at, bo, winA, regionalEvidence / Math.sqrt(1 + repeats));
    a.last = b.last = at;
    meetings.set(pair, [repeats + 1, at]);
    if (cross) {
      a.external.set(b.key, at);
      b.external.set(a.key, at);
    }
    a.schedule.push([at, b.key, region]);
    b.schedule.push([at, a.key, region]);
  }
  return Object.fromEntries([...teams].map(([id, team]) => {
    const remaining = decay(cutoff - team.last, 160);
    return [id, { elo: Number((team.elo * remaining).toFixed(8)),
      formElo: Number((team.formElo * remaining).toFixed(8)), formEvidence: evidence(team, cutoff) }];
  }));
}

// Names can change and the Valve table may list multiple rosters under the same organization.
export function valvePoints(markdown, ids, date) {
  if (!markdown.startsWith('### Standings as of ' + date.replaceAll('-', '_'))) return null;
  const rows = markdown.split('\n').map(line => line.split('|').map(cell => cell.trim()))
    .filter(cells => /^\d+$/.test(cells[1]) && /^[1-9]\d*$/.test(cells[2]))
    .map(cells => ({ points: Number(cells[2]), roster: new Set(cells[4].split(',').map(playerKey)) }));
  const assigned = new Set(), positions = {};
  for (const id of ids) {
    const roster = checkpoint.teams[id]?.roster;
    if (!roster) return null;
    const matches = rows.map((row, index) => ({ ...row, index, core: roster.filter(player => row.roster.has(player)).length }))
      .filter(row => row.core >= 3).sort((a, b) => b.core - a.core);
    const winner = matches[0];
    if (!winner || winner.core === matches[1]?.core || assigned.has(winner.index)) return null;
    positions[id] = winner.points;
    assigned.add(winner.index);
  }
  return positions;
}

async function get(url, fetcher) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(4500),
    headers: { 'user-agent': 'Pickem-dos-Broxinhas/1.0', accept: url.startsWith(valveApi) ? 'application/vnd.github+json' : 'text/plain' } });
  if (!r.ok) throw Error('Consulta Valve indisponível.');
  return r;
}

async function officialValve(ids, cutoffMs, fetcher) {
  const cutoff = new Date(cutoffMs).toISOString();
  const directory = 'live/' + cutoff.slice(0, 4);
  // Use only files published before the activation cutoff, including on retries after activation.
  const revisions = await (await get(valveApi + '/commits?path=' + directory + '&per_page=1&until=' +
    encodeURIComponent(cutoff), fetcher)).json();
  const revision = revisions[0]?.sha;
  if (!/^[0-9a-f]{40}$/.test(revision) || !(Date.parse(revisions[0]?.commit?.committer?.date) <= cutoffMs)) return null;
  const files = await (await get(valveApi + '/contents/' + directory + '?ref=' + revision, fetcher)).json();
  const latest = files.map(file => /^standings_global_(\d{4}_\d{2}_\d{2})\.md$/.exec(file.name))
    .filter(match => match && match[1].replaceAll('_', '-') <= cutoff.slice(0, 10)).sort((a, b) => b[1].localeCompare(a[1]))[0];
  if (!latest) return null;
  const date = latest[1].replaceAll('_', '-');
  const path = directory + '/' + latest[0];
  const raw = await get('https://raw.githubusercontent.com/' + valveRepo + '/' + revision + '/' + path, fetcher);
  const points = valvePoints(await raw.text(), ids, date);
  return points && { date, points, source: 'https://github.com/' + valveRepo + '/blob/' + revision + '/' + path };
}

function hltvForCutoff(ids, cutoffMs) {
  const monday = new Date(cutoffMs);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10) === weekly.date &&
    ids.every(id => Number.isInteger(weekly.positions[id]) && weekly.positions[id] > 0);
}

export async function stageTwoRatings(seededTeams, games, cutoffMs, fetcher = fetch) {
  const ids = seededTeams.map(team => team.id);
  const valve = await officialValve(ids, cutoffMs, fetcher).catch(() => null);
  const hltv = hltvForCutoff(ids, cutoffMs);
  let form;
  if (games.length === 33) {
    try { form = replayForm(games, Math.floor(cutoffMs / 1000)); }
    catch { /* Keep this model pending when any series cannot enter the replay. */ }
  }
  const readyForm = Boolean(form && ids.every(id => form[id]));
  return {
    ...(readyForm ? { formCoverage: 'history-plus-stage1' } : {}),
    teams: seededTeams.map(({ id, name, short, logo }) => ({ id, name, short, logo,
      vrs: valve?.points[id] ?? null, hltvRank: hltv ? weekly.positions[id] : null,
      ...(readyForm ? form[id] : { elo: null, formElo: null, formEvidence: null }) })),
    sources: { vrs: valve?.source ?? null, hltv: hltv ? weekly.source : null, form: readyForm ? SOURCE : null },
    modelDates: { vrs: valve?.date ?? null, hltv: hltv ? weekly.date : null,
      elo: readyForm ? new Date(cutoffMs).toISOString().slice(0, 10) : null },
    formCoverage: 'history-plus-stage1',
    modelStatus: { neutral: 'ready', vrs: valve ? 'ready' : 'pending', hltv: hltv ? 'ready' : 'pending',
      elo: readyForm ? 'ready' : 'pending', study: 'pending', custom: 'ready' },
  };
}
