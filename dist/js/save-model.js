import { phasePath } from './major-phases.js';
import { personalSettings } from './state.js';
import { shareButton } from './share.js';
import { modelAvailable } from './models.js';

export function savedModelIdentity(stage, current) {
  const key = 'published-model:' + stage.id;
  let receipt;
  try { receipt = JSON.parse(localStorage.getItem(key)); } catch {}
  const signature = nick => JSON.stringify([nick, personalSettings(current())]);
  return {
    get receipt() { return receipt; },
    signature,
    nameFor(nick = receipt?.nick) {
      return nick && receipt?.signature === signature(nick) ? receipt.nick : null;
    },
    remember(value) {
      receipt = value;
      try {
        if (value) localStorage.setItem(key, JSON.stringify(value));
        else localStorage.removeItem(key);
      } catch {}
    },
  };
}

export function bindModelSaving(stage, current, onName, $) {
  const form = $('publishModel'),
    nick = form.querySelector('#modelNick');
  const button = $('publishButton'),
    message = $('publishedModel'),
    share = $('modelShare');
  const identity = savedModelIdentity(stage, current);
  const dialog = $('confirmModel');
  const available = key => modelAvailable(stage.teams, key, current(), stage.modelStatus);
  let attempt, busy = false, displayed;
  nick.value = identity.receipt?.nick || $('nick').value;
  function refresh() {
    const saved = identity.nameFor(nick.value.trim());
    button.disabled = busy || !nick.value.trim() || Boolean(saved) || !available('custom');
    button.textContent = busy
      ? 'Salvando…'
      : saved
        ? 'Modelo salvo'
        : 'Salvar modelo';
    if (displayed === Boolean(saved)) return;
    displayed = Boolean(saved);
    share.replaceChildren();
    message.replaceChildren();
    if (saved) {
      const link = document.createElement('a');
      link.href = phasePath('/modelos?modelo=' + encodeURIComponent(identity.receipt.id), stage.id);
      link.textContent = 'Ver modelo publicado';
      message.append(link);
      share.append(
        shareButton(link.href, 'Compartilhar modelo de ' + saved)
      );
    }
    onName(saved || null);
  }
  nick.oninput = refresh;
  form.onsubmit = e => {
    e.preventDefault();
    if (button.disabled || dialog.open || !form.reportValidity()) return;
    if (!available('study')) {
      dialog.showModal();
      $('cancelModelSave').focus();
      return;
    }
    save();
  };
  $('cancelModelSave').onclick = () => dialog.close();
  $('confirmModelSave').onclick = () => {
    if (!dialog.open) return;
    dialog.close();
    if (!button.disabled && form.reportValidity()) save();
  };
  async function save() {
    if (busy || !available('custom')) return;
    const sig = identity.signature(nick.value.trim());
    if (attempt?.sig !== sig) attempt = { sig, id: crypto.randomUUID() };
    const name = nick.value.trim();
    busy = true;
    refresh();
    message.textContent = '';
    try {
      const res = await fetch(phasePath('/api/models', stage.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: attempt.id,
          nick: name,
          settings: personalSettings(current()),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw Error(data.message || 'Falha ao salvar o modelo.');
      identity.remember({ id: data.id, nick: name, signature: sig });
      displayed = undefined;
      document.dispatchEvent(new CustomEvent('model-published', { detail: stage.id }));
    } catch (err) {
      message.textContent = err.message || 'Tente novamente.';
    } finally {
      busy = false;
      refresh();
    }
  }
  refresh();
  return {
    refresh,
    clear() {
      identity.remember(null);
      nick.value = '';
      refresh();
    },
  };
}
