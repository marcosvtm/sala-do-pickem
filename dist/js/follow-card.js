import { validate } from './state.js';

// A followed card is a public simulation input. Keep this preference separate
// from the receipt and the edit key on the device where the card was submitted.
export function bindFollowCard(stage, readReceipt, onSelect) {
  const select = document.getElementById('followNick');
  const status = document.getElementById('followStatus');
  const retry = document.getElementById('retryFollow');
  const key = 'follow-card:' + stage.id;
  let generation = 0, listReady = false;
  let preferred;
  try { preferred = localStorage.getItem(key); } catch {}

  async function loadCard(id, resume = false) {
    const request = ++generation;
    retry.hidden = true;
    status.textContent = id ? 'Carregando cartão…' : '';
    onSelect(null);
    if (!id) return;
    try {
      const res = await fetch('/api/cards/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!res.ok) throw Error();
      const card = await res.json();
      if (request !== generation) return;
      if (card.id !== id || !validate(card.settings)) throw Error();
      onSelect(card, resume);
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
      const res = await fetch('/api/stage/cards', { cache: 'no-store' });
      if (!res.ok) throw Error();
      const { cards } = await res.json();
      if (request !== generation) return;
      select.replaceChildren(new Option('Escolha seu nick', ''),
        ...cards.map((card) => new Option(card.nick, card.id)));
      listReady = true;
      select.disabled = !cards.length;
      status.textContent = cards.length ? '' : 'Nenhum cartão salvo nesta fase.';
      const receipt = readReceipt();
      const id = preferred ?? (receipt?.saved ? receipt.token : null);
      if (id && cards.some((card) => card.id === id)) {
        select.value = id;
        await loadCard(id, true);
      }
    } catch {
      if (request !== generation) return;
      status.textContent = 'Não foi possível carregar a lista de cartões.';
      retry.hidden = false;
    }
  }
  select.onchange = () => {
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
