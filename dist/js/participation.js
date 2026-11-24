import { editKey, readReceipt } from './card-access.js';
import { majorPhases } from './major-phases.js';

const storage = 'sg26:participation';
let saved;
try { saved = JSON.parse(localStorage.getItem(storage)); } catch {}

function receiptFor(stageId) {
  const stage = { id: stageId };
  const receipt = readReceipt(stage);
  const key = receipt?.saved && editKey(stage, receipt.token);
  return key ? { card: receipt.token, nick: receipt.nick, key } : null;
}

async function request(code, receipt) {
  const headers = { 'X-Major-Code': code };
  if (receipt) {
    headers['X-Participant-Card'] = receipt.card;
    headers['X-Card-Key'] = receipt.key;
  }
  const response = await fetch('/api/participant', {
    method: receipt ? 'POST' : 'GET', cache: 'no-store', headers,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.message || 'Não foi possível recuperar a participação.');
  const next = { id: data.id, nick: data.nick, code };
  localStorage.setItem(storage, JSON.stringify(next));
  saved = next;
  return next;
}

async function issue(receipt) {
  // Retrying from the original receipt always recovers the same independent code.
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sg26:recovery:' + receipt.key));
  const code = Array.from(new Uint8Array(hash, 0, 16), b => b.toString(16).padStart(2, '0')).join('');
  return request(code, receipt);
}

export async function participationForCard(stageId) {
  if (saved) return saved.code;
  const index = majorPhases.findIndex(phase => phase.id === stageId);
  const earlier = majorPhases.slice(0, index).map(phase => receiptFor(phase.id)).find(Boolean);
  return earlier ? (await issue(earlier)).code : null;
}

export function bindParticipation(stageId) {
  const $ = id => document.getElementById(id);
  const panel = $('participation');
  const output = $('privateCode');
  const status = $('participantStatus');
  const field = $('restoreCode');
  let busy = false;
  function refresh() {
    const index = majorPhases.findIndex(phase => phase.id === stageId);
    const receipt = majorPhases.slice(0, index + 1).map(phase => receiptFor(phase.id)).find(Boolean);
    const nick = saved?.nick || receipt?.nick;
    const caption = nick ? 'Minha participação · ' + nick : 'Minha participação';
    $('participationTitle').textContent = caption;
    $('participantLabel').textContent = nick
      ? 'Os próximos cartões podem somar pontos para ' + nick + '.'
      : 'Já fez um cartão em outro navegador? Recupere sua participação antes de salvar o próximo.';
    $('showCode').hidden = !saved && !receipt;
    $('showCode').disabled = $('recoverParticipation').disabled = busy;
    return receipt;
  }
  async function run(action) {
    if (busy) return;
    busy = true; refresh();
    try { await action(); }
    catch (error) { status.textContent = error.message || 'Tente novamente.'; }
    finally { busy = false; refresh(); }
  }
  $('showCode').onclick = () => run(async () => {
    const person = saved || await issue(refresh());
    output.value = person.code.match(/.{4}/g).join('-');
    $('codeResult').hidden = false;
    output.focus(); output.select();
    status.textContent = 'Guarde este código para usar em outro navegador.';
  });
  $('copyCode').onclick = async () => {
    try { await navigator.clipboard.writeText(output.value); status.textContent = 'Código copiado.'; }
    catch { output.focus(); output.select(); status.textContent = 'Copie o código selecionado.'; }
  };
  $('recoverForm').onsubmit = event => {
    event.preventDefault();
    run(async () => {
      const code = field.value.trim().toLowerCase().replace(/[\s-]/g, '');
      if (!/^[a-f0-9]{32}$/.test(code)) throw Error('Confira os oito grupos de quatro caracteres.');
      await request(code);
      field.value = output.value = '';
      $('codeResult').hidden = true;
      status.textContent = 'Participação de ' + (saved.nick || 'jogador') + ' recuperada neste navegador.';
    });
  };
  panel.addEventListener('toggle', () => {
    if (!panel.open) {
      $('codeResult').hidden = true;
      field.value = output.value = '';
      status.textContent = '';
    }
    refresh();
  });
  document.addEventListener('card-receipt-changed', refresh);
  refresh();
}
