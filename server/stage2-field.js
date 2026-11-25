import stageOne from '../dist/data/stage.json' with { type: 'json' };
import invited from '../dist/data/stage2-invites.json' with { type: 'json' };
import calendar from '../dist/data/stage2-schedule.json' with { type: 'json' };
import { agendaContext, parseSchedule } from './agenda.js';
import { parsePgl } from './results.js';
import { progress } from '../dist/js/progress.js';

export const stageOneTeams = stageOne.teams.map(team => ({ ...team, id: team.id ?? team.logo.split('.')[0] }));
export const stageTwoCandidates = [...invited.teams, ...stageOneTeams];

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

// Match identities and winners are checked by the same Swiss parser that settles the public cards.
export function formGames(lastFeed) {
  const locks = parsePgl(lastFeed);
  const games = parseSchedule(lastFeed).filter(g => g.status === 'end')
    .sort((a, b) => a.at - b.at || a.round - b.round || a.slot - b.slot)
    .map(g => ({ at: g.at / 1000, a: stageOneTeams[g.a].id, b: stageOneTeams[g.b].id,
      bo: g.bo, winA: Number(g.series[0] > g.series[1]) }));
  if (games.length !== locks.filter(side => side >= 0).length) throw Error('Divergência nos resultados oficiais do S1.');
  return games;
}

export function officialStageTwoField(openingFeed, lastFeed) {
  const promoted = advancingSeeds(parsePgl(lastFeed));
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
  return { seeded, games, startsAt };
}
