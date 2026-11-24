import { phasePath } from './major-phases.js';
import { modelAvailable } from './models.js';
import { shareButton } from './share.js';
import { bindParticipantChoice, rememberParticipant } from './participation.js';
import { editKey, prepareEditKey, readReceipt } from './card-access.js';

export { readReceipt } from './card-access.js';

export function bindSaving(current, stage, receipt, onOwner, editing, onDeadline) {
  const form = document.querySelector('#saveCard'),
    input = form.elements.nick;
  const submit = document.querySelector('#saveButton'),
    message = document.querySelector('#saveMessage');
  const key = 'public-card:' + stage.id;
  form.querySelector('a').href = phasePath('/ranking', stage.id);
  let token = crypto.randomUUID(),
    saved,
    participantId = receipt?.participantId,
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
  const dialog = document.querySelector('#confirmCard');
  const confirm = document.querySelector('#confirmSave');
  const existing = document.querySelector('#existingCard');
  let confirmedChoice = null, writesPaused = false;
  document.addEventListener('phase-card-writes', ({ detail }) => {
    if (detail.id === stage.id && writesPaused !== Boolean(detail.writesPaused)) {
      writesPaused = Boolean(detail.writesPaused);
      if (writesPaused && dialog.open) dialog.close();
      refresh();
    }
  });
  const picker = bindParticipantChoice(stage, editing, receipt, () => {
    existingCard(null);
    delete existing.dataset.card;
    feedback('');
    refresh();
  });
  const dateOptions = { timeZone: 'America/Cuiaba' };
  const closeDay = new Intl.DateTimeFormat('pt-BR', { ...dateOptions, day: '2-digit', month: '2-digit' });
  const closeHour = new Intl.DateTimeFormat('pt-BR', { ...dateOptions, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function ownerChanged() {
    share.hidden = !saved;
    share.replaceChildren();
    if (saved)
      share.append(
        shareButton(phasePath('/ranking#' + token, stage.id), 'Compartilhar cartão de ' + saved)
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
        JSON.stringify({ token, nick: saved || input.value, saved, participantId })
      );
    } catch {}
  }
  function feedback(text, link = false) {
    message.textContent = text;
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = phasePath('/ranking#' + token, stage.id);
      anchor.textContent = 'Ver meu cartão';
      message.append(' ', anchor);
    }
  }
  function existingCard(id) {
    existing.replaceChildren();
    existing.hidden = !id;
    if (!id) return;
    const view = document.createElement('a');
    view.href = phasePath('/ranking#' + id, stage.id);
    view.textContent = 'Ver cartão';
    existing.append('Já existe um cartão deste participante. ', view);
    if (editKey(stage, id) && Date.now() + offset < closeAt) {
      const edit = document.createElement('a');
      edit.href = phasePath('/?editar=' + id, stage.id);
      edit.textContent = 'Editar';
      existing.append(' · ', edit);
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
      if (closed && dialog.open) dialog.close();
    }
    const choice = picker.choice();
    const occupied = !editing && !saved && choice?.cardId;
    if (existing.dataset.card !== (occupied || '')) {
      existing.dataset.card = occupied || '';
      existingCard(occupied);
    }
    const draft = current();
    const available = modelAvailable(stage.teams, draft.model, draft);
    document.querySelector('#saveModelUnavailable').hidden = available || closed;
    submit.disabled =
      writesPaused ||
      Boolean(saved) ||
      pending ||
      Boolean(occupied) ||
      remaining <= 0 ||
      !choice?.nick ||
      draft.card.includes(-1) ||
      !available;
    submit.textContent = writesPaused ? 'Envio pausado' : pending
      ? 'Salvando…'
      : saved
        ? 'Cartão salvo'
        : editing
          ? 'Salvar alterações'
          : 'Salvar cartão';
    picker.setDisabled(Boolean(saved) || pending || closed);
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
    participantId = null;
    input.value = '';
    remember();
    ownerChanged();
    feedback('');
    refresh();
    picker.reset();
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit.disabled || dialog.open || !form.reportValidity()) return;
    const choice = picker.choice();
    if (!choice?.nick) return;
    confirmedChoice = { ...choice };
    document.querySelector('#confirmNick').textContent = "Deseja realmente Salvar como '" + choice.nick + "'?";
    confirm.textContent = 'Sim, salvar como ' + choice.nick;
    dialog.showModal();
    document.querySelector('#correctNick').focus();
  });
  dialog.addEventListener('close', () => {
    confirmedChoice = null;
    if (dialog.returnValue === 'correct' && !wasClosed) picker.choose();
    dialog.returnValue = '';
  });
  document.querySelector('#correctNick').onclick = () => dialog.close('correct');
  confirm.onclick = async () => {
    if (!dialog.open || !confirmedChoice || pending) return;
    const { nick, id: selectedId } = confirmedChoice;
    dialog.close();
    if (writesPaused || Date.now() + offset >= closeAt) { refresh(); return; }
    pending = true;
    refresh();
    feedback('Salvando o cartão…');
    const state = current();
    try {
      const secret = editing
        ? editKey(stage, token)
        : prepareEditKey(stage, token);
      if (!secret) throw Error('Use o navegador em que você salvou o cartão.');
      const headers = { 'Content-Type': 'application/json', 'X-Card-Key': secret };
      if (!editing) remember();
      const response = await fetch(
        phasePath(editing ? '/api/cards/' + token : '/api/cards', stage.id),
        {
          method: editing ? 'PUT' : 'POST',
          headers,
          body: JSON.stringify({
            id: token,
            nick,
            state,
            ...(!editing && { participantId: selectedId }),
            revision: editing?.revision,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        if (data.cardId) picker.markExisting(data.cardId);
        if (data.refreshParticipants) picker.offerRefresh();
        throw new Error(data.message);
      }
      saved = nick.normalize('NFKC').replace(/\s+/g, ' ');
      if (editing) {
        if (readReceipt(stage)?.token === token) {
          localStorage.setItem(
            key,
            JSON.stringify({ ...readReceipt(stage), token, nick: saved, saved })
          );
          localStorage.setItem(stage.id, JSON.stringify(state));
        }
        location.assign(phasePath('/ranking#' + token, stage.id));
        return;
      }
      participantId = selectedId || token;
      rememberParticipant(participantId);
      remember();
      document.dispatchEvent(new Event('card-receipt-changed'));
      ownerChanged();
    } catch (err) {
      feedback(err.message || 'Tente salvar novamente.');
    } finally {
      pending = false;
      refresh();
    }
  };
  refresh();
  if (!wasClosed) picker.load();
  fetch(phasePath('/api/stage', stage.id))
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      if (info) {
        writesPaused = Boolean(info.writesPaused);
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
