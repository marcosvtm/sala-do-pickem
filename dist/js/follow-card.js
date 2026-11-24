import { phasePath } from './major-phases.js';
import { validate } from './state.js';

// A followed card is a public simulation input. Keep this preference separate
// from the receipt and the edit key on the device where the card was submitted.
export function bindFollowCard(stage, readReceipt, onSelect) {
  const select = document.getElementById('followNick');
  const status = document.getElementById('followStatus');
  const retry = document.getElementById('retryFollow');
  const key = 'follow-card:' + stage.id;
  let generation = 0, listReady = false;
  let shared = new URLSearchParams(location.search).get('simular');
  let preferred;
  try { preferred = localStorage.getItem(key); } catch {}

  async function loadCard(id) {
    const request = ++generation;
    retry.hidden = true;
    status.textContent = id ? 'Carregando cartão…' : '';
    onSelect(null, false, Boolean(shared));
    if (!id) return;
    try {
      const res = await fetch(phasePath('/api/cards/' + encodeURIComponent(id),stage.id), { cache: 'no-store' });
      if (!res.ok) throw Error();
      const card = await res.json();
      if (request !== generation) return;
      if (card.id !== id || !validate(card.settings, { stageId: stage.id })) throw Error();
      onSelect(card, !shared, Boolean(shared));
      status.textContent = '';
    } catch {
      if (request !== generation) return;
      status.textContent = 'Não foi possível carregar este cartão.';
      retry.hidden = false;
    }
  }

  async function loadList() {
    const request = ++generation;
    select.disabled = true;
    retry.hidden = true;
    status.textContent = 'Carregando cartões…';
    try {
      const res = await fetch(phasePath('/api/stage/cards', stage.id), { cache: 'no-store' });
      if (!res.ok) throw Error();
      const { cards } = await res.json();
      if (request !== generation) return;
      select.replaceChildren(new Option('Escolha seu nick', ''),
        ...cards.map((card) => new Option(card.nick, card.id)));
      listReady = true;
      select.disabled = !cards.length;
      status.textContent = cards.length ? '' : 'Nenhum cartão salvo nesta fase.';
      const receipt = readReceipt();
      const id = shared ?? preferred ?? (receipt?.saved ? receipt.token : null);
      if (id && cards.some((card) => card.id === id)) {
        select.value = id;
        await loadCard(id);
        if (shared && select.value === id && !status.textContent) {
          const result = document.getElementById('resultado');
          result.focus({ preventScroll: true });
          result.scrollIntoView({ block: 'start' });
        }
      } else if (shared) status.textContent = 'Cartão compartilhado não encontrado.';
    } catch {
      if (request !== generation) return;
      status.textContent = 'Não foi possível carregar a lista de cartões.';
      retry.hidden = false;
    }
  }
  select.onchange = () => {
    if (shared) {
      shared = null;
      const url = new URL(location.href);
      url.searchParams.delete('simular');
      history.replaceState(history.state, '', url);
    }
    preferred = select.value;
    try { localStorage.setItem(key, preferred); } catch {}
    loadCard(preferred);
  };
  retry.onclick = () => listReady ? loadCard(select.value) : loadList();
  return (closed) => {
    generation++;
    listReady = false;
    if (closed) loadList();
    else onSelect(null);
  };
}
