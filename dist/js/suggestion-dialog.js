const $ = (id) => document.getElementById(id);
const pct = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat('pt-BR');
const groups = [
  ['3–0', 0, 2],
  ['3–1 / 3–2', 2, 8],
  ['0–3', 8, 10],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function teamChips(teams, ids, original, highlight) {
  const box = element('div', 'chips');
  if (!ids.length) box.append(element('span', 'blank', 'Nenhum pick'));
  for (const id of ids) {
    const changed = highlight && !original.includes(id);
    const chip = element('span', changed ? 'chip changed' : 'chip');
    const img = new Image();
    img.src = 'assets/' + teams[id].logo;
    img.alt = '';
    chip.append(img, teams[id].name);
    if (changed)
      chip.append(element('span', 'sr-change', ' (mudança na categoria)'));
    box.append(chip);
  }
  return box;
}
function comparison(teams, original, suggestion) {
  const table = element('table', 'records');
  const header = table.createTHead().insertRow();
  for (const name of ['Categoria', 'Seu cartão', 'Sugestão do modelo']) {
    const th = element('th', '', name);
    th.scope = 'col';
    header.append(th);
  }
  const body = table.createTBody();
  const highlight = original.some((id) => id >= 0);
  for (const [label, start, end] of groups) {
    const row = body.insertRow(),
      category = element('th', '', label);
    category.scope = 'row';
    row.append(category);
    const picks = original.slice(start, end).filter((id) => id >= 0);
    const current = row.insertCell(),
      recommended = row.insertCell();
    current.dataset.col = 'Seu cartão';
    recommended.dataset.col = 'Sugestão';
    current.append(teamChips(teams, picks, picks, false));
    recommended.append(
      teamChips(teams, suggestion.slice(start, end), picks, highlight)
    );
  }
  return table;
}

export function bindSuggestions(teams, current, name, apply) {
  const dialog = $('suggestion');
  let worker,
    original,
    signature,
    result,
    seconds,
    refining = false;
  function terminate() {
    worker?.terminate();
    worker = null;
  }
  function controls() {
    $('refine').hidden = refining;
    $('stopSearch').hidden = !refining;
    $('stopSearch').disabled = false;
    $('searchTime').disabled = refining;
    $('apply').disabled = refining || !result || result.keep;
  }
  function show(data) {
    const filled = original.card.filter((id) => id >= 0).length;
    $('currentRate').textContent =
      data.current === null ? '—' : pct.format(data.current);
    $('currentLabel').textContent =
      data.current === null
        ? filled + ' de 10 picks definidos'
        : 'chance de fazer 5+ acertos';
    $('suggestedRate').textContent = pct.format(data.rate);
    const delta =
      data.current === null ? null : 100 * (data.rate - data.current);
    $('improvement').textContent = data.keep
      ? 'Seu cartão igualou ou superou a sugestão nesta comparação.'
      : delta === null
        ? ''
        : delta < 0.1
          ? 'Ganho estimado inferior a 0,1 p.p.'
          : 'Ganho estimado de ≈ ' +
            number.format(Number(delta.toFixed(1))) +
            ' p.p.';
    $('diffLegend').hidden = !filled || data.keep;
    $('picksTable').replaceChildren(
      comparison(teams, original.card, data.card)
    );
    $('validationInfo').textContent = data.fixed
      ? 'Pontuação calculada com todos os resultados fixados.'
      : 'Estimativas em ' +
        number.format(data.count) +
        ' simulações de validação, separadas da busca.';
    $('refinement').hidden = data.fixed;
    $('searchStatus').textContent = data.fixed
      ? 'Chaveamento definido.'
      : number.format(data.comparisons) +
        ' comparações entre cartões · ' +
        number.format(data.starts) +
        ' pontos de partida.';
    $('ready').hidden = false;
  }
  function failed() {
    terminate();
    refining = false;
    controls();
    $('refine').disabled = true;
    $('searchStatus').textContent =
      'Não foi possível continuar. Feche e abra a sugestão para tentar novamente.';
  }
  function start(updated = false) {
    terminate();
    original = structuredClone(current());
    signature = JSON.stringify(original);
    result = null;
    refining = false;
    controls();
    $('ready').hidden = true;
    $('refine').disabled = false;
    $('modelTag').textContent = name();
    const locks = original.locks.filter((side) => side >= 0).length;
    $('suggestionLocks').textContent = locks
      ? locks + ' de 33 resultados definidos na simulação.'
      : 'Chaveamento aberto · 33 partidas a simular.';
    $('searchStatus').textContent = updated
      ? 'Condições atualizadas. Recalculando…'
      : 'Procurando um cartão para este modelo…';
    try {
      const next = new Worker(
        new URL('./suggestion-worker.js', import.meta.url),
        { type: 'module' }
      );
      worker = next;
      next.onerror = () => {
        if (worker === next) failed();
      };
      next.onmessage = ({ data }) => {
        if (worker !== next || !dialog.open) return;
        if (data.type === 'progress') {
          const elapsed = Math.floor(data.elapsed);
          const time = refining
            ? (seconds ? elapsed + ' / ' + seconds + ' s' : elapsed + ' s') +
              ' · '
            : '';
          $('searchStatus').textContent =
            time +
            number.format(data.comparisons) +
            ' comparações · busca em andamento';
          return;
        }
        result = data;
        refining = false;
        controls();
        show(data);
      };
      next.postMessage({ type: 'open', teams, state: original });
    } catch {
      failed();
    }
  }
  function refresh() {
    if (dialog.open && signature !== JSON.stringify(current())) start(true);
  }
  $('suggest').disabled = false;
  $('suggest').onclick = () => {
    dialog.showModal();
    start();
  };
  $('refine').onclick = () => {
    if (!worker || refining) return;
    refining = true;
    seconds = Number($('searchTime').value);
    controls();
    $('stopSearch').focus();
    $('searchStatus').textContent = 'Continuando a busca…';
    worker.postMessage({ type: 'refine', seconds });
  };
  $('stopSearch').onclick = () => {
    $('stopSearch').disabled = true;
    $('searchStatus').textContent = 'Validando a melhor combinação encontrada…';
    worker?.postMessage({ type: 'stop' });
  };
  $('apply').onclick = () => {
    if (!result || result.keep || refining) return;
    if (signature !== JSON.stringify(current())) {
      refresh();
      return;
    }
    const card = result.card;
    dialog.close();
    apply(card);
  };
  $('dismiss').onclick = $('cancel').onclick = () => dialog.close();
  dialog.addEventListener('close', () => {
    if (!dialog.open) {
      terminate();
      result = null;
    }
  });
  window.addEventListener('popstate', () => {
    if (dialog.open && location.pathname !== '/') dialog.close();
  });
  return refresh;
}
