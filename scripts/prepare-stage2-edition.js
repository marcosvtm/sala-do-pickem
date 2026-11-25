import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import stageOne from '../dist/data/stage.json' with { type: 'json' };
import invited from '../dist/data/stage2-invites.json' with { type: 'json' };
import calendar from '../dist/data/stage2-schedule.json' with { type: 'json' };
import weeklyRanking from '../research/stage2-hltv-2026-11-23.json' with { type: 'json' };
import { agendaContext, parseSchedule } from '../server/agenda.js';
import { parsePgl, SOURCE } from '../server/results.js';
import { progress } from '../dist/js/progress.js';

const STAGE = 'sg26-s2-v1';
const stageOneTeams = stageOne.teams.map(team => ({ ...team, id: team.id ?? team.logo.split('.')[0] }));
const pool = [...invited.teams, ...stageOneTeams];
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export function advancingSeeds(locks) {
  if (locks.length !== 33 || !locks.every(side => side === 0 || side === 1))
    throw Error('Aguardando os 33 resultados oficiais do Stage 1.');
  const { teams, finished } = progress(locks);
  const difficulty = teams.map(() => 0);
  for (const { a, b } of finished) {
    difficulty[a] += teams[b].wins - teams[b].losses;
    difficulty[b] += teams[a].wins - teams[a].losses;
  }
  return teams.map(({ wins, losses }, seed) => ({ wins, losses, seed }))
    .filter(team => team.wins === 3)
    .sort((a, b) => a.losses - b.losses || difficulty[b.seed] - difficulty[a.seed] || a.seed - b.seed)
    .map(({ seed }) => stageOneTeams[seed]);
}

function httpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function frozenTeam(team, ratings) {
  if (!Number.isFinite(ratings?.vrs) || ratings.vrs <= 0 || !Number.isInteger(ratings.hltvRank) ||
      ratings.hltvRank < 1 || !Number.isFinite(ratings.formElo) || !Number.isFinite(ratings.elo))
    throw Error('Preencha as forças e o ranking congelados de ' + team.name + '.');
  const evidence = ratings.formEvidence;
  const names = ['series', 'opponents', 'externalOpponents', 'unknownSeries'];
  if (!names.every(key => Number.isInteger(evidence?.[key]) && evidence[key] >= 0) ||
      evidence.opponents > evidence.series || evidence.externalOpponents > evidence.opponents ||
      evidence.unknownSeries > evidence.series) throw Error('Histórico de forma inválido para ' + team.name + '.');
  return { id: team.id, name: team.name, short: team.short, logo: team.logo, vrs: ratings.vrs,
    hltvRank: ratings.hltvRank, elo: ratings.elo, formElo: ratings.formElo,
    formEvidence: Object.fromEntries(names.map(key => [key, evidence[key]])) };
}

export function prepareEdition(input, openingFeed, lastFeed) {
  const promoted = advancingSeeds(parsePgl(lastFeed));
  if (input?.formCoverage === 'history-plus-stage1' && input.stage1Digest !== formDigest(formGames(lastFeed)))
    throw Error('A entrada de forma está desatualizada. Recalcule com os resultados finais do Stage 1.');
  const seeded = [...invited.teams, ...promoted];
  const context = agendaContext(seeded, calendar.games);
  const games = parseSchedule(openingFeed, context);
  const opening = games.filter(game => game.round === 1);
  const pairs = opening.map(({ a, b }) => [a, b].sort((x, y) => x - y).join('/'));
  if (!Array.from({ length: 8 }, (_, i) => pairs.includes(i + '/' + (i + 8))).every(Boolean))
    throw Error('Os oito confrontos da PGL precisam corresponder às seeds calculadas para o Stage 2.');
  for (const round of [1, 2, 3, 4, 5]) {
    const formats = rows => rows.filter(g => g.round === round).map(g => g.bo).sort().join(',');
    if (formats(games) !== formats(calendar.games))
      throw Error('Formato oficial mudou na rodada ' + round + '.');
  }
  const startsAt = Math.min(...opening.map(game => game.at));
  if (input?.stage !== STAGE || typeof input.version !== 'string' || !input.version.trim() ||
      typeof input.cutoff !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(input.cutoff) ||
      !Number.isFinite(Date.parse(input.cutoff)) || Date.parse(input.cutoff) > startsAt - 3600000)
    throw Error('Informe fase, versão e corte dos dados anterior ou igual ao fechamento do cartão.');
  for (const key of ['vrs', 'hltv', 'form']) {
    if (!httpsUrl(input.sources?.[key])) throw Error('Informe a fonte dos dados de ' + key + '.');
  }
  if (!Array.isArray(input.teams) || new Set(input.teams.map(t => t.id)).size !== input.teams.length ||
      !input.teams.every(t => pool.some(candidate => candidate.id === t.id)))
    throw Error('A lista de forças contém equipes repetidas ou fora do evento.');
  const teams = seeded.map(team => frozenTeam(team, input.teams.find(t => t.id === team.id)));
  const links = input.links ?? calendar.links;
  if (links !== undefined && (!Array.isArray(links) || links.length !== 33 ||
      links.some(link => link !== null && (typeof link !== 'string' ||
        !/^https:\/\/www\.hltv\.org\/matches\/\d+\/[\w-]+$/.test(link)))))
    throw Error('Links da HLTV precisam acompanhar os 33 horários oficiais por rodada.');
  return { id: STAGE, version: input.version, startsAt: new Date(startsAt).toISOString(),
    cutoff: input.cutoff, sources: input.sources, ...(input.formCoverage === 'history-plus-stage1' ? { formCoverage: input.formCoverage } : {}), teams, games, ...(links ? { links } : {}) };
}

// Match identities and winners are checked by the same Swiss parser that settles the public cards.
function formGames(lastFeed) {
  const locks = parsePgl(lastFeed);
  const games = parseSchedule(lastFeed).filter(g => g.status === 'end')
    .sort((a, b) => a.at - b.at || a.round - b.round || a.slot - b.slot)
    .map(g => ({ at: g.at / 1000, a: stageOneTeams[g.a].id, b: stageOneTeams[g.b].id,
      bo: g.bo, winA: Number(g.series[0] > g.series[1]) }));
  if (games.length !== locks.filter(side => side >= 0).length) throw Error('Divergência nos resultados oficiais do S1.');
  return games;
}

function formDigest(games) {
  return createHash('sha256').update(JSON.stringify(games)).digest('hex');
}

export function ratePool(lastFeed, now) {
  const games = formGames(lastFeed);
  const cutoff = new Date(Math.floor(now / 1000) * 1000).toISOString();
  const launcher = process.platform === 'win32' && !process.env.STAGE2_PYTHON;
  const python = process.env.STAGE2_PYTHON || (launcher ? 'py' : 'python3');
  const script = fileURLToPath(new URL('calibrate-form.py', import.meta.url));
  const replay = spawnSync(python, [...(launcher ? ['-3'] : []), script, '--stage2'], {
    input: JSON.stringify({ cutoff: Math.floor(now / 1000), games }), encoding: 'utf8', windowsHide: true,
  });
  if (replay.error || replay.status !== 0)
    throw Error('Falha ao calcular a forma dos candidatos: ' + (replay.error?.message || replay.stderr.trim()));
  const ratings = JSON.parse(replay.stdout);
  const teams = pool.map(team => frozenTeam(team, { ...ratings[team.id], vrs: team.vrs, hltvRank: weeklyRanking.positions[team.id] }));
  return { stage: STAGE, version: 'sg26-s2-' + cutoff.slice(0, 19).replace(/[-:]/g, '') + 'Z', cutoff,
    sources: { vrs: invited.sources.vrs, hltv: weeklyRanking.source, form: SOURCE },
    formCoverage: 'history-plus-stage1', stage1Digest: formDigest(games), teams };
}

async function feed(url) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('Falha ao consultar a PGL: ' + response.status);
  return response.json();
}

async function main([action, file, fixture2, fixture1]) {
  if (action === '--pool') {
    const teams = pool.map(({ id, name, vrs }) => ({ id, name, vrs, hltvRank: weeklyRanking.positions[id],
      elo: null, formElo: null, formEvidence: { series: null, opponents: null, externalOpponents: null, unknownSeries: null } }));
    console.log(JSON.stringify({ stage: STAGE, version: '', cutoff: '', sources: { vrs: invited.sources.vrs,
      hltv: weeklyRanking.source, form: '' }, teams }, null, 2));
    return;
  }
  if (!['--ratings', '--status', '--check', '--install'].includes(action) || Boolean(fixture2) !== Boolean(fixture1) ||
      (file && ['--ratings', '--status'].includes(action)))
    throw Error('Use --pool, --ratings, --status, --check [dados.json [agenda-s2.json agenda-s1.json]] ou --install [dados.json].');
  if (action === '--install' && fixture2) throw Error('A instalação exige confirmação nas duas agendas oficiais.');
  const lastFeed = fixture1 ? await readJson(fixture1) : await feed(SOURCE);
  if (action === '--ratings') {
    console.log(JSON.stringify(ratePool(lastFeed, Date.now()), null, 2));
    return;
  }
  const openingFeed = fixture2 ? await readJson(fixture2) : await feed(calendar.source);
  const editionPath = new URL('../dist/data/edition-s2.json', import.meta.url);
  const existing = await readJson(editionPath);
  const now = Date.now();
  const input = file ? await readJson(file) : ratePool(lastFeed, existing ? Date.parse(existing.cutoff) : now);
  if (action === '--status') {
    const games = parseSchedule(lastFeed);
    const settled = games.filter(g => g.status === 'end').length;
    const opening = parseSchedule(openingFeed, agendaContext(pool, calendar.games)).filter(g => g.round === 1);
    const known = opening.filter(g => g.a !== null && g.b !== null).length;
    console.log(input.teams.length + ' candidatos com forças · ' + settled + '/33 séries encerradas no S1 · ' +
      known + '/8 confrontos identificados na abertura do S2.');
    if (settled < 33 || known < 8) { console.log('Aguardando confirmação da PGL.'); return; }
  }
  const result = prepareEdition(input, openingFeed, lastFeed);
  if (action === '--install') {
    const path = editionPath;
    if (existing && JSON.stringify(existing) !== JSON.stringify(result))
      throw Error('A edição publicada é imutável. Revise o procedimento antes de trocar dados dos cartões.');
    if (!existing) {
      if (Date.parse(result.cutoff) > Date.now()) throw Error('O corte dos dados ainda está no futuro.');
      if (Date.now() >= Date.parse(result.startsAt) - 3600000 || result.games.some(g => g.status !== 'upcoming'))
        throw Error('O prazo da fase precisa estar aberto para instalar a primeira edição.');
      const temp = new URL('edition-s2-' + randomUUID() + '.tmp', path);
      try {
        await writeFile(temp, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
        await rename(temp, path);
      } finally { await rm(temp, { force: true }); }
    }
  }
  console.log(result.version + ' · 16 equipes · 8 confrontos de abertura conferidos · ' + action.slice(2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
