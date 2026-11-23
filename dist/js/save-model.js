import { personalSettings } from './state.js';
import { shareButton } from './share.js';

export function bindModelSaving(stage, current, onName) {
  const form = document.getElementById('publishModel'),
    nick = form.querySelector('#modelNick');
  const button = document.getElementById('publishButton'),
    message = document.getElementById('publishedModel'),
    share = document.getElementById('modelShare');
  const key = 'published-model:' + stage.id;
  let receipt,
    attempt,
    busy = false,
    displayed;
  try {
    receipt = JSON.parse(localStorage.getItem(key));
  } catch {}
  nick.value = receipt?.nick || document.getElementById('nick').value;
  function signature() {
    return JSON.stringify([nick.value.trim(), personalSettings(current())]);
  }
  function refresh() {
    const saved = receipt && receipt.signature === signature();
    button.disabled = busy || !nick.value.trim() || Boolean(saved);
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
      link.href = '/modelos?modelo=' + encodeURIComponent(receipt.id);
      link.textContent = 'Ver modelo publicado';
      message.append(link);
      share.append(
        shareButton(link.href, 'Compartilhar modelo de ' + receipt.nick)
      );
    }
    onName(saved ? receipt.nick : null);
  }
  nick.oninput = refresh;
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    const sig = signature();
    if (attempt?.sig !== sig) attempt = { sig, id: crypto.randomUUID() };
    const name = nick.value.trim();
    busy = true;
    refresh();
    message.textContent = '';
    try {
      const res = await fetch('/api/models', {
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
      receipt = { id: data.id, nick: name, signature: sig };
      try {
        localStorage.setItem(key, JSON.stringify(receipt));
      } catch {}
      displayed = undefined;
    } catch (err) {
      message.textContent = err.message || 'Tente novamente.';
    } finally {
      busy = false;
      refresh();
    }
  };
  refresh();
  return {
    refresh,
    clear() {
      receipt = null;
      nick.value = '';
      try {
        localStorage.removeItem(key);
      } catch {}
      refresh();
    },
  };
}
