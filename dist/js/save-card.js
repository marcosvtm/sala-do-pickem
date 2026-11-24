import { shareButton } from './share.js';
import { editKey, prepareEditKey } from './card-access.js';

export function readReceipt(stage) {
  try {
    return JSON.parse(localStorage.getItem('public-card:' + stage.id));
  } catch {
    return null;
  }
}

export function bindSaving(current, stage, receipt, onOwner, editing, onDeadline) {
  const form = document.querySelector('#saveCard'),
    input = form.elements.nick;
  const submit = document.querySelector('#saveButton'),
    message = document.querySelector('#saveMessage');
  const key = 'public-card:' + stage.id;
  let token = crypto.randomUUID(),
    saved,
    pending = false,
    closeAt = Date.parse(stage.startsAt) - 3600000;
  // Also close an already-open tab. The authoritative check is inside the database insert.
  let offset = 0,
    timer, wasClosed;
  if (editing) {
    token = editing.id;
    input.value = editing.nick;
  } else if (receipt?.token) {
    token = receipt.token;
    input.value = receipt.nick || '';
    saved = receipt.saved;
  }
  const share = document.querySelector('#savedShare');
  const timerText = document.querySelector('#countdown');
  const closedLock = document.querySelector('#closedLock');
  const closeLabel = document.querySelector('#closingTime');
  const dateOptions = { timeZone: 'America/Cuiaba' };
  const closeDay = new Intl.DateTimeFormat('pt-BR', { ...dateOptions, day: '2-digit', month: '2-digit' });
  const closeHour = new Intl.DateTimeFormat('pt-BR', { ...dateOptions, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function ownerChanged() {
    share.hidden = !saved;
    share.replaceChildren();
    if (saved)
      share.append(
        shareButton('/cartoes#' + token, 'Compartilhar cartão de ' + saved)
      );
    onOwner(editing?.nick || saved);
  }
  function countdown() {
    const seconds = Math.max(
      0,
      Math.ceil((closeAt - Date.now() - offset) / 1000)
    );
    const parts = [
      Math.floor(seconds / 3600),
      Math.floor(seconds / 60) % 60,
      seconds % 60,
    ];
    timerText.hidden = seconds === 0;
    closedLock.toggleAttribute('hidden', seconds > 0);
    if (seconds) timerText.textContent = parts.map((n) => String(n).padStart(2, '0')).join(':');
    const day = closeDay.format(closeAt), hour = closeHour.format(closeAt);
    closeLabel.textContent = seconds
      ? `Fechamento em ${day}, ${hour} (Cuiabá)`
      : `Fechado ${day} às ${hour} (UTC-4)`;
  }
  ownerChanged();
  countdown();
  setInterval(() => {
    if (!document.hidden) countdown();
  }, 1000);
  function remember() {
    if (editing) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ token, nick: input.value, saved })
      );
    } catch {}
  }
  function feedback(text, link = false) {
    message.textContent = text;
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = '/cartoes#' + token;
      anchor.textContent = 'Ver meu cartão';
      message.append(' ', anchor);
    }
  }
  function refresh() {
    clearTimeout(timer);
    const remaining = closeAt - (Date.now() + offset);
    const closed = remaining <= 0;
    if (closed !== wasClosed) {
      wasClosed = closed;
      form.hidden = closed;
      onDeadline(closed);
    }
    submit.disabled =
      Boolean(saved) ||
      pending ||
      remaining <= 0 ||
      !input.value.trim() ||
      current().card.includes(-1);
    submit.textContent = pending
      ? 'Salvando…'
      : saved
        ? 'Cartão salvo'
        : editing
          ? 'Salvar alterações'
          : 'Salvar cartão';
    input.disabled = Boolean(saved) || pending || remaining <= 0;
    document.querySelector('#anotherNick').hidden = !saved || remaining <= 0;
    document.querySelector('#saveDeadline').textContent =
      (remaining <= 0 ? 'Salvamento encerrado em ' : 'Prazo: ') +
      new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Cuiaba',
      }).format(closeAt) +
      ' (Cuiabá).';
    if (remaining > 0)
      timer = setTimeout(refresh, Math.min(remaining + 20, 3600000));
    if (saved) feedback('Cartão de ' + saved + ' salvo.', true);
  }
  input.oninput = () => {
    remember();
    refresh();
  };
  document.querySelector('#anotherNick').onclick = () => {
    saved = null;
    token = crypto.randomUUID();
    input.value = '';
    remember();
    ownerChanged();
    feedback('');
    refresh();
    input.focus();
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled || !form.reportValidity()) return;
    const nick = input.value.trim();
    pending = true;
    refresh();
    feedback('Salvando o cartão…');
    const state = current();
    try {
      const secret = editing
        ? editKey(stage, token)
        : prepareEditKey(stage, token);
      if (!secret) throw Error('Use o navegador em que você salvou o cartão.');
      const response = await fetch(
        editing ? '/api/cards/' + token : '/api/cards',
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Card-Key': secret },
          body: JSON.stringify({
            id: token,
            nick,
            state,
            revision: editing?.revision,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      saved = nick.normalize('NFKC').replace(/\s+/g, ' ');
      if (editing) {
        if (readReceipt(stage)?.token === token) {
          localStorage.setItem(
            key,
            JSON.stringify({ token, nick: saved, saved })
          );
          localStorage.setItem(stage.id, JSON.stringify(state));
        }
        location.assign('/cartoes#' + token);
        return;
      }
      remember();
      ownerChanged();
    } catch (err) {
      feedback(err.message || 'Tente salvar novamente.');
    } finally {
      pending = false;
      refresh();
    }
  });
  refresh();
  fetch('/api/stage')
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (info) {
        closeAt = info.closesAt;
        offset = info.serverTime - Date.now();
        refresh();
        countdown();
      }
    })
    .catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
  return refresh;
}
