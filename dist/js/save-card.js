import { shareButton } from './share.js';

export function bindSaving(current, stage, onOwner) {
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
    timer;
  try {
    const draft = JSON.parse(localStorage.getItem(key) || 'null');
    if (draft) {
      token = draft.token;
      input.value = draft.nick || '';
      saved = draft.saved;
    }
  } catch {}
  const share = document.querySelector('#savedShare');
  function ownerChanged() {
    share.hidden = !saved;
    share.replaceChildren();
    if (saved)
      share.append(
        shareButton('/cartoes#' + token, 'Compartilhar cartão de ' + saved)
      );
    onOwner(saved);
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
    document.querySelector('#countdown').textContent = seconds
      ? parts.map((n) => String(n).padStart(2, '0')).join(':')
      : 'Prazo encerrado';
    document.querySelector('#closingTime').textContent =
      'Fechamento em ' +
      new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Cuiaba',
      }).format(closeAt) +
      ' (Cuiabá)';
  }
  ownerChanged();
  countdown();
  setInterval(() => {
    if (!document.hidden) countdown();
  }, 1000);
  function remember() {
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
    submit.disabled =
      Boolean(saved) || pending || remaining <= 0 || !input.value.trim();
    submit.textContent = saved ? 'Cartão salvo' : 'Salvar cartão';
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
      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: token, nick, state }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      saved = nick.normalize('NFKC').replace(/\s+/g, ' ');
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
}
