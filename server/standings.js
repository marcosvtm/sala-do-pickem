import { progress } from '../dist/js/progress.js';
import { findStage, stageCatalog } from './stages.js';

export const scoredCardsSql = `SELECT id,nick,submitted,revision,settings,participant_id AS participantId,edit_hash IS NOT NULL AS hasEditKey,
  (SELECT count(*) FROM json_each(cards.settings,'$.card') p
   WHERE json_extract(?, '$[' || p.value || ']')= CASE WHEN p.key<2 THEN 0 WHEN p.key<8 THEN 1 ELSE 2 END) hits
  FROM cards WHERE stage=? AND removed_at IS NULL`;

export function swissBuckets(locks) {
  return JSON.stringify(progress(locks).teams.map(({ wins, losses }) =>
    wins === 3 ? (losses === 0 ? 0 : 1) : losses === 3 && wins === 0 ? 2 : -1
  ));
}

export function overallStandings(cards) {
  const players = new Map();
  for (const card of cards) {
    // Stage 1 card IDs are stable. Later stages can supply a verified participant ID.
    const id = card.participantId || card.id;
    const player = players.get(id) || { id, nick: card.nick, hits: 0, phases: {} };
    player.phases[card.stage] = {
      id: card.id, hits: card.hits, model: card.model, formVersion: card.formVersion,
      nick: card.nick,
    };
    player.hits += card.hits;
    players.set(id, player);
  }
  const rows = [...players.values()].sort((a, b) =>
    b.hits - a.hits || a.nick.localeCompare(b.nick, 'pt-BR') || a.id.localeCompare(b.id)
  );
  let place = 0;
  for (const [index, row] of rows.entries()) {
    if (!index || row.hits !== rows[index - 1].hits) place = index + 1;
    row.place = place;
  }
  return rows;
}

export async function majorRanking(db, now, fetcher, page, size) {
  const { stages } = stageCatalog(now);
  const cards = [];
  let stale = false;
  for (const phase of stages.filter(p => p.status !== 'preparing')) {
    const stage = findStage(phase.id);
    const live = await stage.readResults(db, now, fetcher);
    stale ||= Boolean(live.stale);
    const { results } = await db.prepare(`WITH scored AS (${scoredCardsSql})
      SELECT id,nick,hits,participantId,json_extract(settings,'$.model') AS model,
      coalesce(json_extract(settings,'$.formVersion'),1) AS formVersion FROM scored`)
      .bind(swissBuckets(live.locks), phase.id).all();
    for (const row of results) cards.push({ ...row, stage: phase.id });
  }
  const rows = overallStandings(cards);
  return { page, hasMore: rows.length > (page + 1) * size, stale, stages,
    rows: rows.slice(page * size, (page + 1) * size) };
}
