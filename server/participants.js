const reply = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function recoveryHash(req) {
  const code = req.headers.get('X-Major-Code');
  if (!code || !/^[a-f0-9]{32}$/.test(code)) return null;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('major:' + code));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function identity(db, hash) {
  return db.prepare(`SELECT p.id, (
    SELECT nick FROM cards c WHERE c.removed_at IS NULL
      AND (c.participant_id=p.id OR c.id=p.id)
    ORDER BY c.submitted,c.id LIMIT 1
  ) AS nick FROM participants p WHERE recovery_hash=?`).bind(hash).first();
}

export async function authenticatedParticipant(req, db) {
  const hash = await recoveryHash(req);
  return hash && identity(db, hash);
}

export async function participantApi(req, db, ownerHash) {
  const hash = await recoveryHash(req);
  if (!hash) return reply({ message: 'Confira o código privado de participação.' }, 403);
  if (req.method === 'POST') {
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(req.url).origin) return reply({ message: 'Origem inválida.' }, 403);
    const card = req.headers.get('X-Participant-Card');
    const owner = await ownerHash(req);
    if (!card || !owner) return reply({ message: 'O recibo do cartão é necessário.' }, 403);
    const verified = await db.prepare(`SELECT id FROM cards WHERE id=? AND edit_hash=?
      AND removed_at IS NULL AND (participant_id IS NULL OR participant_id=id)`).bind(card, owner).first();
    if (!verified) return reply({ message: 'O recibo não corresponde a esse participante.' }, 403);
    await db.prepare('INSERT INTO participants(id,recovery_hash) VALUES(?,?) ON CONFLICT DO NOTHING')
      .bind(card, hash).run();
    const participant = await identity(db, hash);
    if (participant?.id !== card) return reply({ message: 'Use o código já emitido para este cartão.' }, 409);
    return reply(participant);
  }
  if (req.method !== 'GET') return reply({ message: 'Método indisponível.' }, 405);
  const participant = await identity(db, hash);
  return participant ? reply(participant) : reply({ message: 'Código de participação não reconhecido.' }, 403);
}
