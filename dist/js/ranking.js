const $ = (id) => document.getElementById(id);
function element(tag, text, cls) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (cls) el.className = cls;
  return el;
}
function link(text, href) {
  const a = element('a', text);
  a.href = href;
  return a;
}
async function showProfile(card, cell) {
  const info = element('div', undefined, 'rank-profile');
  const status = element('span', 'Consultando o Ranking Broxas…');
  const cardLink = link('Ver cartão de ' + card.nick, '/cartoes#' + card.id);
  info.append(cardLink, status);
  cell.replaceChildren(info);
  try {
    const res = await fetch('/api/ranking/' + card.id + '/perfil');
    if (!res.ok) throw Error();
    const data = await res.json();
    if (data.unavailable) throw Error();
    const p = data.member;
    if (!p) {
      status.textContent = 'Sem correspondência de nick no Ranking Broxas.';
      return;
    }
    const month = new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      timeZone: 'UTC',
    }).format(Date.UTC(data.year, data.month - 1, 1));
    const player = element('span', undefined, 'rank-player');
    if (p.level !== null) {
      const badge = element('b', p.level, 'gc-level');
      badge.dataset.band =
        p.level >= 19
          ? 'orange'
          : p.level >= 15
            ? 'gold'
            : p.level >= 12
              ? 'green'
              : 'blue';
      badge.setAttribute('role', 'img');
      badge.setAttribute('aria-label', 'Nível GC ' + p.level);
      player.append(badge);
    }
    cardLink.textContent = p.name;
    cardLink.setAttribute('aria-label', 'Ver cartão de ' + p.name);
    player.append(cardLink);
    const parts = [
      link('Ranking Broxas (chopp)', 'https://rankingbroxas.duckdns.org/'),
      player,
    ];
    if (p.choppPlace != null)
      parts.push(p.choppPlace + 'º lugar Chopp');
    if (p.score !== null)
      parts.push(p.score + (p.score === 1 ? ' ponto' : ' pontos'));
    if (p.games !== null)
      parts.push(
        p.games + (p.games === 1 ? ' jogo em ' : ' jogos em ') +
          month[0].toUpperCase() + month.slice(1)
      );
    const list = element('ul', undefined, 'chopp-summary');
    for (const part of parts) {
      const item = element('li');
      item.append(part);
      list.append(item);
    }
    info.replaceChildren(list);
    if (data.stale)
      info.append(element('small', 'Exibindo a última consulta disponível.'));
  } catch {
    status.textContent =
      'As estatísticas do grupo estão temporariamente indisponíveis.';
  }
}

let page = 0,
  busy = false,
  signature,
  expanded;
function render(data) {
  $('rankingStatus').textContent = data.rows.length
    ? (data.finished
        ? data.finished + ' de 33 partidas encerradas.'
        : 'Aguardando o primeiro resultado.') +
      (data.stale ? ' Última chave disponível.' : '') +
      ' Clique em um nick para ver o cartão e os dados do grupo.'
    : 'Ainda não há cartões nesta página.';
  $('prevRank').hidden = !page;
  $('nextRank').hidden = !data.hasMore;
  const next = JSON.stringify([page, data.rows, data.finished]);
  if (signature === next) return;
  signature = next;
  const body = $('standings');
  body.replaceChildren();
  for (const card of data.rows) {
    const row = body.insertRow();
    const place = element(
      'b',
      data.finished ? card.place + 'º' : '—',
      'rank-place'
    );
    if (card.hits && card.place <= 3)
      place.classList.add('podium-' + card.place);
    row.insertCell().append(place);
    const name = element('button', card.nick, 'rank-nick');
    name.type = 'button';
    row.insertCell().append(name);
    row.insertCell().textContent = card.hits + ' / 10';
    const detail = body.insertRow();
    detail.id = 'profile-' + card.id;
    name.setAttribute('aria-controls', detail.id);
    const cell = detail.insertCell();
    cell.colSpan = 3;
    const toggle = (open) => {
      detail.hidden = !open;
      name.setAttribute('aria-expanded', String(open));
      if (open) showProfile(card, cell);
    };
    toggle(card.id === expanded);
    name.onclick = () => {
      const open = detail.hidden;
      for (const current of body.querySelectorAll(
        'button[aria-expanded="true"]'
      )) {
        current.setAttribute('aria-expanded', 'false');
        $(current.getAttribute('aria-controls')).hidden = true;
      }
      expanded = open ? card.id : null;
      toggle(open);
    };
  }
}
async function refresh() {
  if (busy) return;
  busy = true;
  $('reloadRanking').disabled =
    $('prevRank').disabled =
    $('nextRank').disabled =
      true;
  try {
    const res = await fetch('/api/ranking?page=' + page, { cache: 'no-store' });
    if (!res.ok) throw Error();
    render(await res.json());
  } catch {
    $('rankingStatus').textContent =
      'Não foi possível atualizar o ranking. Tente novamente.';
  } finally {
    busy = false;
    $('reloadRanking').disabled =
      $('prevRank').disabled =
      $('nextRank').disabled =
        false;
  }
}
$('prevRank').onclick = () => {
  if (page) page--;
  refresh();
};
$('nextRank').onclick = () => {
  page++;
  refresh();
};
$('reloadRanking').onclick = refresh;
setInterval(() => {
  if (!document.hidden) refresh();
}, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});
refresh();
