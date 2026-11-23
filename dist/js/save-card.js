import { MODELS } from './models.js';

export function bindSaving(current, stage) {
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
      saved = nick;
      remember();
      feedback('Cartão salvo com o modelo ' + MODELS[state.model] + '.', true);
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
      }
    })
    .catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}
