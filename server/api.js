import stage from '../dist/data/stage.json' with { type: 'json' };
import {
  defaults,
  validate,
  validPersonal,
  personalSettings,
} from '../dist/js/state.js';
import { progress } from '../dist/js/progress.js';
import { CLOSE, liveResults } from './results.js';
import { broxasProfile } from './broxas.js';

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (message, status) => json({ message }, status);
const closed = () => failure('O prazo de salvamento desta fase terminou.', 409);
const uuid =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
async function ownerHash(req) {
  const key = req.headers.get('X-Card-Key');
  if (!key || !uuid.test(key)) return null;
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(key)
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}
async function changeCard(db, now, id, hash, revision, update) {
  if (now >= CLOSE) return closed();
  if (!hash)
    return failure('Use o navegador em que você salvou o cartão.', 403);
  if (!Number.isSafeInteger(revision) || revision < 1)
    return failure('Versão de cartão inválida.', 400);
  const guard =
    ' WHERE stage=? AND id=? AND edit_hash=? AND revision=? AND removed_at IS NULL AND unixepoch() < ?';
  const args = [stage.id, id, hash, revision, CLOSE / 1000];
  // Keep a scrubbed tombstone so a delayed create request cannot restore a deleted card.
  const result = update
    ? await db
        .prepare(
          'UPDATE OR IGNORE cards SET nick=?,nick_key=?,settings=?,revision=revision+1' +
            guard
        )
        .bind(update.nick, update.nickKey, update.settings, ...args)
        .run()
    : await db
        .prepare(
          "UPDATE cards SET removed_at=unixepoch(),nick='',nick_key='!'||id,settings='{}',revision=revision+1" +
            guard
        )
        .bind(...args)
        .run();
  if (result.meta.changes) return json({ id, revision: revision + 1 });
  const clock = await db
    .prepare('SELECT unixepoch() >= ? AS closed')
    .bind(CLOSE / 1000)
    .first();
  if (clock.closed) return closed();
  const prior = await db
    .prepare(
      'SELECT nick,settings,revision,removed_at FROM cards WHERE stage=? AND id=? AND edit_hash=?'
    )
    .bind(stage.id, id, hash)
    .first();
  if (!prior)
    return failure('Use o navegador em que você salvou o cartão.', 403);
  if (prior.removed_at !== null)
    return update ? failure('O cartão foi excluído.', 410) : json({ id });
  if (
    update &&
    prior.revision === revision + 1 &&
    prior.nick === update.nick &&
    prior.settings === update.settings
  )
    return json({ id, revision: prior.revision });
  if (prior.revision !== revision)
    return failure(
      'O cartão mudou em outra aba. Atualize o mural e abra a versão mais recente.',
      409
    );
  return failure('Este nick já tem um cartão na fase.', 409);
}
export async function cardsApi(req, db, now = Date.now(), fetcher = fetch) {
  const url = new URL(req.url);
  const profileId = url.pathname.match(
    /^\/api\/ranking\/([^/]+)\/perfil$/
  )?.[1];
  if (req.method === 'GET' && profileId && uuid.test(profileId)) {
    const row = await db
      .prepare(
        'SELECT nick FROM cards WHERE stage=? AND id=? AND removed_at IS NULL'
      )
      .bind(stage.id, profileId)
      .first();
    if (!row) return failure('Cartão não encontrado.', 404);
    return json(await broxasProfile(row.nick, now, fetcher));
  }
  const ranking = url.pathname === '/api/ranking' && req.method === 'GET';
  if (url.pathname === '/api/stage' && req.method === 'GET')
    return json({ serverTime: now, closesAt: CLOSE });
  if (url.pathname === '/api/results' && req.method === 'GET')
    return json(await liveResults(db, now, fetcher, true));
  if (req.method === 'GET' && url.pathname.startsWith('/api/models/')) {
    const publicId = url.pathname.slice('/api/models/'.length);
    const standalone = publicId.startsWith('m-');
    const id = standalone ? publicId.slice(2) : publicId;
    const row =
      uuid.test(id) &&
      (await db
        .prepare(
          standalone
            ? 'SELECT id,nick,settings FROM personal_models WHERE stage=? AND id=?'
            : 'SELECT id,nick,settings FROM cards WHERE stage=? AND id=? AND removed_at IS NULL'
        )
        .bind(stage.id, id)
        .first());
    if (!row) return failure('Modelo não encontrado nesta fase.', 404);
    const settings = JSON.parse(row.settings);
    return json({
      id: publicId,
      nick: row.nick,
      ...personalSettings(settings),
      description: settings.description || '',
    });
  }
  if (url.pathname === '/api/models' && req.method === 'GET') {
    const raw = url.searchParams.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(raw)) return failure('Página inválida.', 400);
    const size = 30;
    const { results } = await db
      .prepare(
        `SELECT id,nick,submitted,source FROM (
          SELECT id,nick,submitted,'card' AS source FROM cards WHERE stage=? AND removed_at IS NULL
          UNION ALL SELECT 'm-' || id,nick,submitted,'model' FROM personal_models WHERE stage=?
        ) ORDER BY submitted DESC,id LIMIT ? OFFSET ?`
      )
      .bind(stage.id, stage.id, size + 1, Number(raw) * size)
      .all();
    return json({
      models: results.slice(0, size),
      hasMore: results.length > size,
    });
  }
  const modelOnly = url.pathname === '/api/models' && req.method === 'POST';
  const cardId = url.pathname.startsWith('/api/cards/')
    ? url.pathname.slice('/api/cards/'.length)
    : '';
  const single = uuid.test(cardId);
  if (url.pathname !== '/api/cards' && !modelOnly && !single && !ranking)
    return failure('Página não encontrada.', 404);
  if (single && req.method === 'GET') {
    const card = await db
      .prepare(
        'SELECT id,nick,settings,revision FROM cards WHERE stage=? AND id=? AND removed_at IS NULL'
      )
      .bind(stage.id, cardId)
      .first();
    return card
      ? json({
          ...card,
          settings: JSON.parse(card.settings),
          serverTime: now,
          closesAt: CLOSE,
        })
      : failure('Cartão não encontrado.', 404);
  }
  if (req.method === 'GET') {
    const live = await liveResults(db, now, fetcher);
    const { teams } = progress(live.locks);
    const bucket = teams.map(({ wins: w, losses: l }) =>
      w === 3 ? (l === 0 ? 0 : 1) : l === 3 && w === 0 ? 2 : -1
    );
    const raw = url.searchParams.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(raw)) return failure('Página inválida.', 400);
    let page = Number(raw);
    const size = 30;
    const ranked = `SELECT id,nick,submitted,revision,settings,edit_hash IS NOT NULL AS hasEditKey,
      (SELECT count(*) FROM json_each(cards.settings,'$.card') p
       WHERE json_extract(?, '$[' || p.value || ']')= CASE WHEN p.key<2 THEN 0 WHEN p.key<8 THEN 1 ELSE 2 END) hits
      FROM cards WHERE stage=? AND removed_at IS NULL`;
    const ordering = 'ORDER BY hits DESC,submitted ASC,id ASC';
    if (ranking) {
      const { results } = await db
        .prepare(
          'WITH scored AS (' +
            ranked +
            ') SELECT id,nick,hits,RANK() OVER (ORDER BY hits DESC) AS place FROM scored ' +
            ordering +
            ' LIMIT ? OFFSET ?'
        )
        .bind(JSON.stringify(bucket), stage.id, size + 1, page * size)
        .all();
      return json({
        page,
        hasMore: results.length > size,
        finished: live.locks.filter((x) => x >= 0).length,
        stale: live.stale,
        rows: results.slice(0, size),
      });
    }
    const focus = url.searchParams.get('focus');
    if (focus && uuid.test(focus)) {
      const pos = await db
        .prepare(
          `WITH ranked AS (${ranked}), numbered AS (SELECT id,row_number() OVER (${ordering}) AS n FROM ranked) SELECT n FROM numbered WHERE id=?`
        )
        .bind(JSON.stringify(bucket), stage.id, focus)
        .first();
      if (pos) page = Math.floor((pos.n - 1) / size);
    }
    const { results } = await db
      .prepare(ranked + ' ' + ordering + ' LIMIT ? OFFSET ?')
      .bind(JSON.stringify(bucket), stage.id, size + 1, page * size)
      .all();
    return json({
      serverTime: now,
      closesAt: CLOSE,
      page,
      hasMore: results.length > size,
      live,
      cards: results
        .slice(0, size)
        .map((r) => ({ ...r, settings: JSON.parse(r.settings) })),
    });
  }
  if (single ? !['PUT', 'DELETE'].includes(req.method) : req.method !== 'POST')
    return failure('Método indisponível.', 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== url.origin)
    return failure('Origem inválida.', 403);
  if (!req.headers.get('content-type')?.startsWith('application/json'))
    return failure('Envie JSON.', 415);
  if (Number(req.headers.get('content-length')) > 4096)
    return failure('Cartão muito grande.', 413);
  let body;
  try {
    const text = await req.text();
    if (text.length > 4096) return failure('Cartão muito grande.', 413);
    body = JSON.parse(text);
  } catch {
    return failure('Cartão ilegível.', 400);
  }
  if (single && req.method === 'DELETE')
    return changeCard(
      db,
      now,
      cardId,
      await ownerHash(req),
      body?.revision,
      null
    );
  const nick =
    typeof body?.nick === 'string'
      ? body.nick.normalize('NFKC').trim().replace(/\s+/g, ' ')
      : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._\-]{0,31}$/u.test(nick))
    return failure(
      'Use um nick de 1 a 32 caracteres, começando com letra ou número.',
      400
    );
  const nickKey = nick.toLocaleLowerCase('pt-BR');
  if (modelOnly) {
    if (!uuid.test(body.id) || !validPersonal(body.settings))
      return failure('Confira os pesos e os ajustes do modelo.', 400);
    const snapshot = JSON.stringify(personalSettings(body.settings));
    await db
      .prepare(
        `INSERT INTO personal_models(id,stage,nick,nick_key,submitted,settings)
      VALUES(?,?,?,?,unixepoch(),?) ON CONFLICT DO NOTHING`
      )
      .bind(body.id, stage.id, nick, nickKey, snapshot)
      .run();
    const row = await db
      .prepare(
        'SELECT id,nick FROM personal_models WHERE stage=? AND nick_key=? AND settings=?'
      )
      .bind(stage.id, nickKey, snapshot)
      .first();
    return row
      ? json({ id: 'm-' + row.id, nick: row.nick })
      : failure('Identificador de modelo já utilizado.', 409);
  }
  const id = single ? cardId : body.id;
  if (!uuid.test(id) || !validate(body.state))
    return failure('O cartão ou o modelo está incompleto.', 400);
  const { card, model } = body.state;
  const settings = JSON.stringify({
    ...defaults(card),
    model,
    ...personalSettings(body.state),
    ...(!body.state.weights &&
    !body.state.base &&
    body.state.description?.trim()
      ? { description: body.state.description.trim() }
      : {}),
  });
  const hash = await ownerHash(req);
  if (single)
    return changeCard(db, now, id, hash, body.revision, {
      nick,
      nickKey,
      settings,
    });
  if (req.headers.has('X-Card-Key') && !hash)
    return failure('Chave do cartão inválida.', 400);
  const retry = async () => {
    const prior = await db
      .prepare(
        'SELECT id,nick_key,settings,edit_hash FROM cards WHERE stage=? AND id=? AND removed_at IS NULL'
      )
      .bind(stage.id, body.id)
      .first();
    return (
      prior?.nick_key === nickKey &&
      prior.settings === settings &&
      prior.edit_hash === hash
    );
  };
  if (now >= CLOSE) return (await retry()) ? json({ id: body.id }) : closed();
  // The database clock guards the actual insert as well as the request-time gate.
  const result = await db
    .prepare(
      `INSERT INTO cards(id,stage,nick,nick_key,submitted,settings,edit_hash)
    SELECT ?,?,?,?,unixepoch(),?,? WHERE unixepoch() < ? ON CONFLICT DO NOTHING`
    )
    .bind(body.id, stage.id, nick, nickKey, settings, hash, CLOSE / 1000)
    .run();
  if (result.meta.changes) return json({ id: body.id }, 201);
  if (await retry()) return json({ id: body.id });
  const clock = await db
    .prepare('SELECT unixepoch() >= ? AS closed')
    .bind(CLOSE / 1000)
    .first();
  if (clock.closed) return closed();
  return failure(
    'Este nick já tem um cartão registrado nesta fase. Escolha outro se for uma pessoa diferente.',
    409
  );
}
