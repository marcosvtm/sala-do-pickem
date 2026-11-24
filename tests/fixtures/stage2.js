import stageOne from '../../dist/data/stage.json' with { type: 'json' };
import invited from '../../dist/data/stage2-invites.json' with { type: 'json' };
import { availableGames } from '../../dist/js/swiss.js';
import { advancingSeeds, prepareEdition } from '../../scripts/prepare-stage2-edition.js';

// Synthetic scores for isolated tests; production installation always fetches both PGL feeds.
export function fixtureRows(teams, date, finished) {
  return availableGames(Array(33).fill(0)).flatMap((games, round) => games.map((game, slot) => ({
    date, time: '12:00', timeZone: 'SGT', format: 'BO' + game.bo,
    round: round ? 'round ' + (round + 1) : 'opening round m' + (slot + 1),
    leftTeamKey: round && !finished ? '' : teams[game.a].id,
    rightTeamKey: round && !finished ? '' : teams[game.b].id,
    leftScore: finished ? Math.ceil(game.bo / 2) : 0, rightScore: 0,
    status: finished ? 'end' : 'upcoming', maps: [],
  })));
}

export function rehearsal() {
  const field = [...invited.teams, ...advancingSeeds(Array(33).fill(0))];
  const first = fixtureRows(stageOne.teams.map(t => ({ id: t.logo.split('.')[0] })), '25.11.2026', true);
  const second = fixtureRows(field, '28.11.2026', false);
  const input = {
    stage: 'sg26-s2-v1', version: 'isolated-rehearsal', cutoff: '2026-11-27T15:00:00Z',
    sources: { hltv: 'https://example.org/positions', vrs: 'https://example.org/vrs', form: 'https://example.org/form' },
    teams: field.map(({ id, vrs }, i) => ({ id, vrs, hltvRank: i + 1, elo: i, formElo: i * 2,
      formEvidence: { series: 20, opponents: 4, externalOpponents: 2, unknownSeries: 1 } })),
  };
  return { first, second, input, edition: prepareEdition(input, second, first) };
}
