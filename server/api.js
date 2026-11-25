import { futureAgendaConfig, readFutureAgenda } from './future-agenda.js';
import { STAGE_TWO, stageTwoActivation } from './stage2-activation.js';
import { authenticatedParticipant, participantApi, participantDirectory, participantDisplayName } from './participants.js';
import { modelAvailable, mixWeights, studyFor } from '../dist/js/models.js';
import {
  defaults,
  validate,
  validPersonal,
  personalSettings,
} from '../dist/js/state.js';
import { scoredCardsSql, swissBuckets, majorRanking } from './standings.js';
import { LEGACY_STAGE_ID, calendarPreview, packagedStageTwo, findStage, navigationCatalog, readStageInfo } from './stages.js';

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
async function changeCard(db, stage, now, id, hash, revision, update) {
  if (now >= stage.closesAt) return closed();
  if (!hash)
    return failure('Use o navegador em que você salvou o cartão.', 403);
  if (!Number.isSafeInteger(revision) || revision < 1)
    return failure('Versão de cartão inválida.', 400);
  const guard =
    ' WHERE stage=? AND id=? AND edit_hash=? AND revision=? AND removed_at IS NULL AND unixepoch() < ?';
  const args = [stage.id, id, hash, revision, stage.closesAt / 1000];
  // Keep a scrubbed tombstone so a delayed create request cannot restore a deleted card.
  const result = update
    ? await db
        .prepare(
          'UPDATE OR IGNORE cards SET nick=?,nick_key=?,settings=?,revision=revision+1' + guard +
            ` AND (nick_key=? OR NOT EXISTS (
               SELECT 1 FROM cards AS other WHERE other.nick_key=? AND other.removed_at IS NULL
                 AND coalesce(other.participant_id,other.id) <> coalesce(cards.participant_id,cards.id)
             ))`
        )
        .bind(update.nick, update.nickKey, update.settings, ...args, update.nickKey, update.nickKey)
        .run()
    : await db
        .prepare(
          "UPDATE cards SET removed_at=unixepoch(),participant_id=NULL,nick='',nick_key='!'||id,settings='{}',revision=revision+1" +
            guard
        )
        .bind(...args)
        .run();
  if (result.meta.changes) return json({ id, revision: revision + 1 });
  const clock = await db
    .prepare('SELECT unixepoch() >= ? AS closed')
    .bind(stage.closesAt / 1000)
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
  return failure('Este nick já pertence a outro participante do Major.', 409);
}
export async function cardsApi(req, db, now = Date.now(), fetcher = fetch, defer, pausedStage) {
  const url = new URL(req.url);
  if (url.pathname === '/api/participant') return participantApi(req, db, ownerHash);
  const activationRoute = url.pathname === '/api/stage2/activation';
  const editionRoute = url.pathname === '/data/edition-s2.json';
  if ((activationRoute || editionRoute) && !['GET', 'HEAD'].includes(req.method))
    return failure('Método indisponível.', 405);
  const needsEdition = activationRoute || editionRoute || url.pathname === '/api/stages' ||
    url.pathname === '/api/ranking/geral' || url.searchParams.get('stage') === STAGE_TWO;
  const activation = needsEdition && !packagedStageTwo
    ? await stageTwoActivation(db, now, fetcher, {
        check: activationRoute || editionRoute || Boolean(defer),
        defer: activationRoute || editionRoute ? undefined : defer,
      })
    : null;
  let edition = activation?.edition ?? packagedStageTwo;
  if (edition) {
    const study = studyFor(edition.id);
    const studyReady = Boolean(study && modelAvailable(edition.teams, 'study', { stage: edition.id }));
    const editionVersion = edition.version + '.' + (edition.revision ?? 0) + (studyReady ? '.' + study.version : '');
    edition = { ...edition, editionVersion,
      ...(edition.modelStatus && { modelStatus: { ...edition.modelStatus, study: studyReady ? 'ready' : 'pending' } }) };
  }
  if (editionRoute) return req.method === 'HEAD' ? new Response(null, { headers: json(null).headers }) : json(edition);
  if (activationRoute) {
    const info = await readStageInfo(findStage(STAGE_TWO, edition), now, pausedStage, db);
    return json({ ...info, activatedAt: activation?.activatedAt, attemptedAt: activation?.attemptedAt,
      detail: activation?.detail, modelStatus: edition?.modelStatus });
  }
  if (url.pathname === '/api/stages')
    return req.method === 'GET'
      ? json({ serverTime: now, ...await navigationCatalog(db, now, fetcher, defer, pausedStage, edition) })
      : failure('Método indisponível.', 405);
  if (url.pathname === '/api/ranking/geral' && req.method === 'GET') {
    const raw = url.searchParams.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(raw)) return failure('Página inválida.', 400);
    return json(await majorRanking(db, now, fetcher, Number(raw), 30, edition));
  }
  const requested = url.searchParams.getAll('stage');
  if (requested.length > 1) return failure('Informe apenas uma fase.', 400);
  const stage = findStage(requested[0] ?? LEGACY_STAGE_ID, edition);
  if (!stage) return failure('Fase não encontrada.', 404);
  const info = await readStageInfo(stage, now, pausedStage, db);
  if (url.pathname === '/api/stage/participants' && req.method === 'GET')
    return json(await participantDirectory(db, stage.id));
  if (url.pathname === '/api/stage' && req.method === 'GET')
    return json({ serverTime: now, ...info, invitedTeams: stage.invitedTeams });
  if (info.status === 'preparing') {
    if (url.pathname === '/api/results' && req.method === 'GET' && futureAgendaConfig(stage.id))
      return json(await readFutureAgenda(stage.id, db, now, fetcher));
    if (url.pathname === '/api/results' && req.method === 'GET')
      return stage.previewSchedule ? json(calendarPreview(stage)) : failure('Agenda ainda não publicada.', 409);
    return failure(stage.name + ' em preparação. Aguarde a confirmação das equipes.', 409);
  }
  const ranking = url.pathname === '/api/ranking' && req.method === 'GET';
  if (url.pathname === '/api/stage/cards' && req.method === 'GET') {
    const { results } = await db.prepare(
      'SELECT id,nick FROM cards WHERE stage=? AND removed_at IS NULL ORDER BY nick COLLATE NOCASE,id'
    ).bind(stage.id).all();
    return json({ cards: results });
  }
  if (url.pathname === '/api/results' && req.method === 'GET')
    return json(await stage.readResults(db, now, fetcher, true));
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
          closesAt: stage.closesAt,
        })
      : failure('Cartão não encontrado.', 404);
  }
  if (req.method === 'GET') {
    const live = await stage.readResults(db, now, fetcher);
    const bucket = swissBuckets(live.locks);
    const raw = url.searchParams.get('page') ?? '0';
    if (!/^\d{1,5}$/.test(raw)) return failure('Página inválida.', 400);
    let page = Number(raw);
    const size = 30;
    const ranked = scoredCardsSql;
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
        .bind(bucket, stage.id, size + 1, page * size)
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
        .bind(bucket, stage.id, focus)
        .first();
      if (pos) page = Math.floor((pos.n - 1) / size);
    }
    const { results } = await db
      .prepare('WITH scored AS (' + ranked + ') SELECT *,RANK() OVER (ORDER BY hits DESC) AS place FROM scored ' + ordering + ' LIMIT ? OFFSET ?')
      .bind(bucket, stage.id, size + 1, page * size)
      .all();
    return json({
      serverTime: now,
      closesAt: stage.closesAt,
      writesPaused: info.writesPaused,
      editionVersion: stage.editionVersion,
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
  if (info.writesPaused && !modelOnly)
    return failure('O envio de cartões está pausado. Seus picks continuam neste navegador.', 409);
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
  if ([body?.stage, body?.state?.stage, body?.settings?.stage].some(
    (id) => id !== undefined && id !== stage.id
  )) return failure('A fase informada difere da fase do pedido.', 400);
  if (single && req.method === 'DELETE')
    return changeCard(
      db,
      stage,
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
    if (stage.modelStatus && !modelAvailable(stage.teams, 'custom', { ...body.settings, stage: stage.id }, stage.modelStatus))
      return failure('Um dos modelos com peso nesta mistura ainda está em atualização.', 409);
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
  if (!uuid.test(id) || !validate(body.state, { stageId: stage.id }))
    return failure('O cartão ou o modelo está incompleto.', 400);
  const { card, model } = body.state;
  if (stage.id !== LEGACY_STAGE_ID && !modelAvailable(stage.teams ?? [], model, body.state, stage.modelStatus))
    return failure('O modelo escolhido ainda não está disponível nesta fase.', 409);
  const usesStudy = model === 'study' || (model === 'custom' && mixWeights(body.state)?.study > 0);
  const settings = JSON.stringify({
    ...defaults(card, stage.id),
    model,
    ...personalSettings(body.state),
    ...(stage.id !== LEGACY_STAGE_ID && { editionVersion: stage.editionVersion,
      studyVersion: usesStudy ? studyFor(stage.id)?.version : undefined }),
    ...(!body.state.weights &&
    !body.state.base &&
    body.state.description?.trim()
      ? { description: body.state.description.trim() }
      : {}),
  });
  const hash = await ownerHash(req);
  if (single)
    return changeCard(db, stage, now, id, hash, body.revision, {
      nick,
      nickKey,
      settings,
    });
  if (req.headers.has('X-Card-Key') && !hash)
    return failure('Chave do cartão inválida.', 400);
  const linked = req.headers.has('X-Major-Code') ? await authenticatedParticipant(req, db) : null;
  if (req.headers.has('X-Major-Code') && !linked)
    return failure('Código de participação inválido. Recupere sua participação antes de salvar.', 403);
  // New clients explicitly choose an existing participant or null for a first entry.
  // Requests from earlier releases keep their receipt/code-based behavior.
  const choosing = Object.hasOwn(body, 'participantId');
  const selected = body.participantId;
  if (choosing && selected !== null && (typeof selected !== 'string' || !uuid.test(selected)))
    return failure('Escolha um participante da lista.', 400);
  if (choosing && linked && selected !== linked.id)
    return failure('Confira o participante escolhido antes de salvar.', 400);
  const participantId = selected ?? linked?.id ?? id;
  const retry = async () => {
    const prior = await db
      .prepare(
        'SELECT id,nick_key,settings,edit_hash,participant_id FROM cards WHERE stage=? AND id=? AND removed_at IS NULL'
      )
      .bind(stage.id, body.id)
      .first();
    return (
      prior?.nick_key === nickKey &&
      prior.settings === settings &&
      prior.edit_hash === hash &&
      (prior.participant_id ?? prior.id) === participantId
    );
  };
  if (now >= stage.closesAt) return (await retry()) ? json({ id: body.id }) : closed();
  let choiceGuard = '';
  let choiceArgs = [];
  if (choosing) {
    if (selected) {
      choiceGuard = ' AND (' + participantDisplayName + ')=?';
      choiceArgs = [selected, nick];
    } else {
      choiceGuard = ' AND NOT EXISTS (SELECT 1 FROM cards WHERE nick_key=? AND removed_at IS NULL)';
      choiceArgs = [nickKey];
    }
  }
  // The database clock guards the actual insert as well as the request-time gate.
  const result = await db
    .prepare(
      `INSERT INTO cards(id,stage,nick,nick_key,submitted,settings,edit_hash,participant_id)
    SELECT ?,?,?,?,unixepoch(),?,?,? WHERE unixepoch() < ? AND NOT EXISTS (
      SELECT 1 FROM cards WHERE stage=? AND id=? AND removed_at IS NULL
    ) ${choiceGuard} ON CONFLICT DO NOTHING`
    )
    .bind(body.id, stage.id, nick, nickKey, settings, hash, participantId, stage.closesAt / 1000, stage.id, participantId, ...choiceArgs)
    .run();
  if (result.meta.changes) return json({ id: body.id }, 201);
  if (await retry()) return json({ id: body.id });
  if (linked || selected) {
    const existing = await db.prepare('SELECT id FROM cards WHERE stage=? AND coalesce(participant_id,id)=? AND removed_at IS NULL').bind(stage.id, participantId).first();
    if (existing) return json({ message: 'Este participante já salvou um cartão nesta fase.', cardId: existing.id }, 409);
  }
  const clock = await db
    .prepare('SELECT unixepoch() >= ? AS closed')
    .bind(stage.closesAt / 1000)
    .first();
  if (clock.closed) return closed();
  if (choosing) return json({ refreshParticipants: true, message: selected
    ? 'Atualize a lista de participantes e confira o nick escolhido.'
    : 'Este nick já foi usado no Major. Escolha a pessoa na lista ou use seu próprio nick.' }, 409);
  return failure(
    'Este nick já tem um cartão registrado nesta fase. Escolha outro se for uma pessoa diferente.',
    409
  );
}
