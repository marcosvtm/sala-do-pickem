import { majorPhases, phasePath } from './major-phases.js';
import { editKey, readReceipt } from './card-access.js';

const currentPerson = 'sg26:last-saved-participant';
const newcomer = 'new';

function familiarIds() {
  const ids = [];
  try {
    ids.push(localStorage.getItem(currentPerson));
    // Honor a participation already recovered on this device in an earlier release.
    ids.push(JSON.parse(localStorage.getItem('sg26:participation'))?.id);
  } catch {}
  for (const phase of [...majorPhases].reverse()) {
    const receipt = readReceipt(phase);
    if (receipt?.saved && editKey(phase, receipt.token)) ids.push(receipt.participantId || receipt.token);
  }
  return ids.filter(Boolean);
}

export function rememberParticipant(id) {
  try { localStorage.setItem(currentPerson, id); } catch {}
}

export function bindParticipantChoice(stage, editing, receipt, onChange) {
  const $ = id => document.getElementById(id);
  const select = $('participantChoice'), input = $('nick'), retry = $('reloadParticipants');
  let people = [], ready = false, busy = false, disabled = false, compact = false;
  if (editing) input.value = editing.nick;

  function selected() { return people.find(person => person.id === select.value); }
  function render() {
    const person = selected();
    const entering = select.value === newcomer || Boolean(editing);
    $('chooseParticipant').hidden = Boolean(editing) || compact;
    $('knownParticipant').hidden = !compact || !person;
    $('knownNick').textContent = person?.nick || '';
    $('changeParticipant').disabled = disabled;
    $('newParticipant').hidden = !entering;
    input.disabled = !entering || disabled;
    select.disabled = disabled || !ready;
    retry.disabled = busy || disabled;
  }
  function choose() {
    compact = false;
    render();
    if (editing) input.focus();
    else select.focus();
  }
  async function load({ recognize = true } = {}) {
    if (editing || busy) return;
    busy = true;
    ready = false;
    retry.hidden = true;
    select.replaceChildren(new Option('Carregando participantes…', ''));
    render();
    onChange();
    try {
      const res = await fetch(phasePath('/api/stage/participants', stage.id), { cache: 'no-store' });
      if (!res.ok) throw Error();
      const data = await res.json();
      if (!Array.isArray(data.participants) || !data.participants.every(
        p => p && typeof p.id === 'string' && typeof p.nick === 'string'
      )) throw Error();
      people = data.participants;
      select.replaceChildren(new Option('Escolha seu nick', ''),
        ...people.map(p => new Option(p.nick, p.id)), new Option('É minha primeira participação', newcomer));
      const knownIds = recognize ? [receipt?.participantId, receipt?.saved && receipt.token, ...familiarIds()] : [];
      const known = knownIds.find(id => people.some(person => person.id === id));
      if (known) select.value = known;
      else if (!people.length || (recognize && receipt?.nick && !receipt.saved)) select.value = newcomer;
      compact = Boolean(known);
      ready = true;
    } catch {
      select.replaceChildren(new Option('Lista indisponível', ''));
      compact = false;
      retry.hidden = false;
    } finally {
      busy = false;
      render();
      onChange();
    }
  }
  $('changeParticipant').onclick = choose;
  select.onchange = () => {
    render();
    onChange();
    if (select.value === newcomer) input.focus();
  };
  retry.onclick = () => load({ recognize: false });
  render();
  return {
    load, choose,
    offerRefresh() {
      choose();
      retry.textContent = 'Atualizar participantes';
      retry.hidden = false;
    },
    markExisting(cardId) {
      const person = selected();
      if (person) person.cardId = cardId;
    },
    setDisabled(value) { disabled = value; render(); },
    choice() {
      if (editing || (ready && select.value === newcomer))
        return { nick: input.value.normalize('NFKC').trim().replace(/\s+/g, ' '), id: null };
      return ready ? selected() : null;
    },
    reset() {
      compact = false;
      select.value = '';
      input.value = '';
      load({ recognize: false }).then(choose);
    },
  };
}
