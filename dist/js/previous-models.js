import { majorPhases, phasePath } from './major-phases.js';
import { personalSettings, validPersonal } from './state.js';

// The legacy S1 roster stores the PGL identifier in the logo filename.
const teamId = team => team.id ?? team.logo.split('.')[0];

export function copyTeamSettings(model, previousTeams, nextTeams) {
  if (!validPersonal(model) || previousTeams.length !== model.trust.length)
    throw Error('Os ajustes do modelo não correspondem ao elenco de origem.');
  const previous = new Map(previousTeams.map((team, i) => [teamId(team), i]));
  const settings = personalSettings(model);
  const adjusted = [];
  settings.trust = [];
  settings.bonus = [];
  for (const team of nextTeams) {
    const i = previous.get(teamId(team));
    const trust = model.trust[i] ?? 100;
    const bonus = model.bonus[i] ?? 0;
    settings.trust.push(trust);
    settings.bonus.push(bonus);
    if (trust !== 100 || bonus !== 0) adjusted.push(team.name);
  }
  return { settings, adjusted };
}

export function bindPreviousModels(stage, apply, $) {
  const index = majorPhases.findIndex(phase => phase.id === stage.id);
  const previous = majorPhases[index - 1];
  if (!previous?.rosterUrl) return;
  const panel = $('previousModels'), select = $('previousModel'), copy = $('copyPreviousModel');
  const message = $('previousModelResult'), retry = $('retryPreviousModels');
  panel.hidden = false;
  $('previousModelsTitle').textContent = 'Copiar um modelo do ' + previous.name;
  let roster, loading = false;
  async function get(url) {
    const response = await fetch(url);
    if (!response.ok) throw Error();
    return response.json();
  }
  async function list() {
    if (loading) return;
    loading = true;
    retry.hidden = true;
    message.textContent = 'Carregando modelos…';
    try {
      roster = await get(previous.rosterUrl);
      if (roster?.id !== previous.id) throw Error();
      const entries = [];
      let page = 0, data;
      do {
        data = await get(phasePath('/api/models?page=' + page++, previous.id));
        entries.push(...data.models);
      } while (data.hasMore);
      select.replaceChildren(new Option('Escolha um modelo', ''),
        ...entries.map(m => new Option(m.nick + (m.source === 'card' ? ' · cartão' : ' · modelo salvo'), m.id)));
      message.textContent = entries.length ? '' : 'Esta fase ainda não tem modelos salvos.';
    } catch {
      roster = null;
      message.textContent = 'Não foi possível carregar os modelos da fase anterior.';
      retry.hidden = false;
    } finally { loading = false; }
  }
  panel.ontoggle = () => { if (panel.open && !roster) list(); };
  retry.onclick = list;
  select.onchange = () => { copy.disabled = !select.value; message.textContent = ''; };
  copy.onclick = async () => {
    copy.disabled = select.disabled = true;
    try {
      const model = await get(phasePath('/api/models/' + encodeURIComponent(select.value), previous.id));
      const { settings, adjusted } = copyTeamSettings(model, roster.teams, stage.teams);
      const omitted = apply(settings);
      message.textContent = adjusted.length
        ? 'Modelo copiado. Ajustes individuais mantidos para ' + adjusted.join(', ') + '.'
        : 'Modelo copiado. Todas as equipes começam com os ajustes padrão.';
      if (omitted?.length) message.textContent += ' Peso zerado nesta cópia enquanto a fase aguarda ' + omitted.join(', ') + '.';
    } catch { message.textContent = 'Falha ao copiar o modelo. Tente novamente.'; }
    finally { select.disabled = false; copy.disabled = !select.value; }
  };
}
