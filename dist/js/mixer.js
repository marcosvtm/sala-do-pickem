import { MODELS, PRESETS, mixWeights, mixPercentages } from './models.js';
import { newDraft } from './state.js';


export function bindMixer(current, changed, $, hasStudy) {
  const controls = new Map();

  function setWeights(weights) {
    const model = current();
    delete model.base;
    delete model.weight;
    delete model.description;
    model.weights = weights;
  }

  for (const key of PRESETS) {
    const row = document.createElement('div');
    row.className = 'mix-row mix-' + key;
    const label = document.createElement('label'),
      range = document.createElement('input'),
      points = document.createElement('input'),
      share = document.createElement('span'),
      segment = document.createElement('span');

    range.type = 'range';
    range.id = 'mix-' + key;
    range.setAttribute('aria-describedby', 'mixHint');
    label.htmlFor = range.id;
    label.textContent = MODELS[key];
    points.type = 'number';
    if (key === 'study' && !hasStudy) {
      points.disabled = range.disabled = true;
      label.textContent += ' (em preparação)';
    }
    points.inputMode = 'numeric';
    points.setAttribute('aria-label', 'Pontos de ' + MODELS[key]);
    share.className = 'mix-share';
    share.id = 'share-' + key;
    points.setAttribute('aria-describedby', share.id);
    segment.className = 'mix-' + key;
    for (const input of [points, range]) {
      input.min = 0;
      input.max = 100;
      input.step = 1;
    }
    const entry = document.createElement('span');
    entry.className = 'mix-entry';
    const unit = document.createElement('small');
    unit.textContent = 'pts';
    unit.setAttribute('aria-hidden', 'true');
    entry.append(points, unit);
    row.append(label, range, entry, share);
    $('mixControls').append(row);
    $('mixBar').append(segment);
    controls.set(key, { points, range, share, segment });

    let dirty = false;
    function setPoint(value) {
      const weights = mixWeights(current());
      if (weights[key] === value) return;
      setWeights({ ...weights, [key]: value });
      dirty = true;
      changed(true);
    }
    function finish() {
      if (!dirty) return;
      dirty = false;
      changed(false);
    }
    range.oninput = () => setPoint(range.valueAsNumber);
    range.onchange = range.onblur = range.onlostpointercapture = finish;
    points.oninput = () => {
      if (points.value !== '' && points.validity.valid)
        setPoint(points.valueAsNumber);
    };
    points.onchange = points.onblur = () => {
      const value = Number.isFinite(points.valueAsNumber)
        ? points.valueAsNumber
        : 0;
      const bounded = Math.max(0, Math.min(100, Math.round(value)));
      points.value = bounded;
      setPoint(bounded);
      finish();
    };
  }
  function initialWeights() {
    const weights = newDraft().weights;
    if (!hasStudy) weights.study = 0;
    return weights;
  }
  $('equalMix').onclick = () => {
    setWeights(initialWeights());
    changed(false);
  };
  $('startMix').onclick = () => {
    current().trust.fill(100);
    setWeights(initialWeights());
    changed(false);
    controls.get('neutral').range.focus();
  };

  return function renderMixer() {
    const weights = mixWeights(current());
    $('mixEditor').hidden = $('equalMix').hidden = !weights;
    $('legacyMix').hidden = Boolean(weights);
    if (!weights) return;
    const percentages = mixPercentages(weights);
    $('emptyMix').hidden = PRESETS.some((key) => weights[key] > 0);
    for (const [key, { points, range, share, segment }] of controls) {
      const value = weights[key],
        portion = percentages[key];
      const percent = portion.toLocaleString('pt-BR') + '%';
      range.value = value;
      if (document.activeElement !== points) points.value = value;
      range.setAttribute(
        'aria-valuetext',
        value + ' pontos, ' + percent + ' da mistura'
      );
      share.textContent = percent;
      segment.style.flexGrow = portion;
    }
  };
}
