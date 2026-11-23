import stage from '../dist/data/stage.json' with { type: 'json' };
import { defaults, validate } from '../dist/js/state.js';
import { progress } from '../dist/js/progress.js';
import { CLOSE, liveResults } from './results.js';

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (message, status) => json({ message }, status);
const closed = () => failure('O prazo de salvamento desta fase terminou.', 409);
const uuid =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
export async function cardsApi(req, db, now = Date.now(), fetcher = fetch) {
  const url = new URL(req.url);
  if (url.pathname === '/api/stage' && req.method === 'GET')
    return json({ serverTime: now, closesAt: CLOSE });
  if (url.pathname !== '/api/cards')
    return failure('Página não encontrada.', 404);
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
    const ranked = `SELECT id,nick,submitted,settings,
      (SELECT count(*) FROM json_each(cards.settings,'$.card') p
       WHERE json_extract(?, '$[' || p.value || ']')= CASE WHEN p.key<2 THEN 0 WHEN p.key<8 THEN 1 ELSE 2 END) hits
      FROM cards WHERE stage=?`;
    const ordering = 'ORDER BY hits DESC,submitted ASC,id ASC';
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
      serverTime: Date.now(),
      closesAt: CLOSE,
      page,
      hasMore: results.length > size,
      live,
      cards: results
        .slice(0, size)
        .map((r) => ({ ...r, settings: JSON.parse(r.settings) })),
    });
  }
  if (req.method !== 'POST') return failure('Método indisponível.', 405);
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
  const nick =
    typeof body?.nick === 'string'
      ? body.nick.normalize('NFKC').trim().replace(/\s+/g, ' ')
      : '';
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._\-]{0,31}$/u.test(nick))
    return failure(
      'Use um nick de 1 a 32 caracteres, começando com letra ou número.',
      400
    );
  if (!uuid.test(body.id) || !validate(body.state))
    return failure('O cartão ou o modelo está incompleto.', 400);
  const { card, model, form, trust, bonus } = body.state;
  const settings = JSON.stringify({
    ...defaults(card),
    model,
    form,
    trust,
    bonus,
  });
  const nickKey = nick.toLocaleLowerCase('pt-BR');
  const retry = async () => {
    const prior = await db
      .prepare('SELECT id,nick_key,settings FROM cards WHERE stage=? AND id=?')
      .bind(stage.id, body.id)
      .first();
    return prior?.nick_key === nickKey && prior.settings === settings;
  };
  if (now >= CLOSE) return (await retry()) ? json({ id: body.id }) : closed();
  // The database clock guards the actual insert as well as the request-time gate.
  const result = await db
    .prepare(
      `INSERT INTO cards(id,stage,nick,nick_key,submitted,settings)
    SELECT ?,?,?,?,unixepoch(),? WHERE unixepoch() < ? ON CONFLICT DO NOTHING`
    )
    .bind(body.id, stage.id, nick, nickKey, settings, CLOSE / 1000)
    .run();
  if (result.meta.changes) return json({ id: body.id }, 201);
  if (await retry()) return json({ id: body.id });
  const clock = await db.prepare('SELECT unixepoch() >= ? AS closed').bind(CLOSE / 1000).first();
  if (clock.closed) return closed();
  return failure(
    'Este nick já tem um cartão registrado nesta fase. Escolha outro se for uma pessoa diferente.',
    409
  );
}
