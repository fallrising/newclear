// Domain functions accept numbers only. DOM string parsing is a separate boundary.
export const limits = Object.freeze({ x: [-20, 60], a: [0.5, 2], b: [-10, 10] });

export function validateInputs(input) {
  for (const [key, [minimum, maximum]] of Object.entries(limits)) {
    const value = input?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${key} 必須是有限數值，不能空白。`);
    }
    if (value < minimum || value > maximum) {
      throw new Error(`${key} 必須介於 ${minimum} 與 ${maximum} 之間。`);
    }
  }
  return input;
}

export function parseNumericInput(text, label) {
  if (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim())) {
    throw new Error(`${label} 請輸入數字，不能空白。`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label} 必須是有限數值。`);
  return value;
}

export function createForwardEvaluator(Circuit) {
  // Builder: create the fixed graph once; coefficients remain runtime source cells.
  const circuit = new Circuit(3);
  const x = circuit.source(0);
  const a = circuit.source(1);
  const b = circuit.source(2);
  const y = circuit.affine([[circuit.multiply(a, x), 1], [b, 1]]);
  const evaluate = circuit.createTensorEvaluator([y]);
  return input => {
    validateInputs(input);
    // Runtime: replace the source values, execute on CPU, copy the scalar result.
    return evaluate(new Float32Array([input.x, input.a, input.b]))[0];
  };
}

export function compareForward(input, evaluate) {
  validateInputs(input); // Must run before any graph evaluation.
  const reference = input.a * input.x + input.b;
  const graph = evaluate(input);
  if (typeof graph !== 'number' || !Number.isFinite(graph)) {
    throw new Error('圖執行未產生有限數值，已停止比較。');
  }
  const difference = Math.abs(graph - reference);
  const tolerance = 1e-5 + 1e-5 * Math.abs(reference);
  return { reference, graph, difference, tolerance, passed: difference <= tolerance };
}

export function bindForwardPage(document, evaluate) {
  const el = id => document.getElementById(id);
  const status = el('status');
  const outputIDs = ['reference', 'graph', 'difference', 'tolerance', 'formula-value'];
  function update() {
    // Clear success and every derived value before parsing or executing.
    status.dataset.state = 'pending';
    status.textContent = '正在比較…';
    for (const id of outputIDs) el(id).textContent = '—';
    for (const key of Object.keys(limits)) el(`${key}-number`).setAttribute('aria-invalid', 'false');
    try {
      const input = {};
      for (const [key, [minimum, maximum]] of Object.entries(limits)) {
        const field = el(`${key}-number`);
        try {
          const value = parseNumericInput(field.value, key);
          if (value < minimum || value > maximum) {
            throw new Error(`${key} 必須介於 ${minimum} 與 ${maximum} 之間。`);
          }
          input[key] = value;
          el(`${key}-range`).value = String(value);
        } catch (error) {
          field.setAttribute('aria-invalid', 'true');
          throw error;
        }
      }
      const result = compareForward(input, evaluate);
      for (const id of ['reference', 'graph', 'difference', 'tolerance']) {
        el(id).textContent = String(result[id]);
      }
      el('formula-value').textContent = `${input.a} × (${input.x}) + (${input.b})`;
      status.dataset.state = result.passed ? 'pass' : 'fail';
      status.textContent = result.passed ? '通過 · 差值在固定容許值內' : '超差 · 差值超出固定容許值';
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = `無法比較 · ${error.message}`;
    }
  }
  for (const key of Object.keys(limits)) {
    el(`${key}-number`).addEventListener('input', update);
    el(`${key}-range`).addEventListener('input', () => {
      el(`${key}-number`).value = el(`${key}-range`).value;
      update();
    });
  }
  update();
  return Object.freeze({ applyCoefficients({ a, b }) {
    validateInputs({ x: 0, a, b });
    for (const [key, value] of Object.entries({ a, b })) {
      el(`${key}-number`).value = String(value);
      el(`${key}-range`).value = String(value);
    }
    update(); // Preserve x, including an invalid/empty x and its visible error.
  } });
}

export const trainingPoints = Object.freeze([-20, -10, 0, 10, 20, 30, 40, 50, 60]);

function validateCoefficients({ alpha, b }) {
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) throw new Error('alpha 必須是有限數值。');
  validateInputs({ x: 0, a: alpha / 40, b });
}

export function createLearningEvaluator(Circuit) {
  // A fixed nine-point MSE graph. Backward differentiates its loss wire, not a
  // separately hardcoded derivative; normalization keeps the stated rate useful.
  const circuit = new Circuit(2);
  const alpha = circuit.source(0), b = circuit.source(1);
  const predictions = [], squaredErrors = [];
  for (const x of trainingPoints) {
    const prediction = circuit.affine([[alpha, x / 40], [b, 1]]);
    const error = circuit.affine([[prediction, 1]], -(1.25 * x - 2));
    predictions.push(prediction);
    squaredErrors.push(circuit.multiply(error, error));
  }
  const loss = circuit.affine(squaredErrors.map(wire => [wire, 1 / trainingPoints.length]));
  return parameters => {
    validateCoefficients(parameters);
    const values = circuit.evaluateReference(new Float32Array([parameters.alpha, parameters.b]));
    const seeds = new Float32Array(values.length);
    seeds[loss] = 1;
    const gradients = circuit.backpropagateReference(values, seeds);
    return Object.freeze({ loss: values[loss], dAlpha: gradients[alpha], dB: gradients[b],
      maxError: Math.max(...predictions.map((wire, i) => Math.abs(values[wire] - (1.25 * trainingPoints[i] - 2)))) });
  };
}

function learningMetrics(evaluate, parameters) {
  const metrics = evaluate(parameters);
  const result = {};
  for (const key of ['loss', 'dAlpha', 'dB', 'maxError']) {
    if (typeof metrics?.[key] !== 'number' || !Number.isFinite(metrics[key])) {
      throw new Error(`${key} 未產生有限數值（${String(metrics?.[key])}）。`);
    }
    result[key] = metrics[key];
  }
  if (result.loss < 0 || result.maxError < 0) throw new Error('loss 與最大誤差不得為負數。');
  return result;
}

function snapshot(parameters, step, metrics) {
  return Object.freeze({ step, alpha: parameters.alpha, a: parameters.alpha / 40, b: parameters.b, ...metrics });
}

export function startLearning(evaluate) {
  const parameters = { alpha: 40, b: 0 };
  try {
    const current = snapshot(parameters, 0, learningMetrics(evaluate, parameters));
    return Object.freeze({ ...current, status: 'ready', reason: '', history: Object.freeze([current]) });
  } catch (error) {
    return Object.freeze({ ...snapshot(parameters, 0, { loss: null, dAlpha: null, dB: null, maxError: null }),
      status: 'stopped', reason: `停止：${error.message}`, history: Object.freeze([]) });
  }
}

export function stepLearning(state, evaluate, learningRate = 0.05) {
  if (learningRate !== 0.05 && learningRate !== 2) throw new Error('學習率必須是 0.05 或示範用 2.0。');
  if (state.status === 'stopped' || state.status === 'complete' || state.step >= 500) return state;
  const candidate = { alpha: state.alpha - learningRate * state.dAlpha, b: state.b - learningRate * state.dB };
  try {
    validateCoefficients(candidate);
  } catch (error) {
    return Object.freeze({ ...state, status: 'stopped', reason:
      `停止：第 ${state.step + 1} 步候選 a=${candidate.alpha / 40}、b=${candidate.b}；${error.message} 保留上一組合法係數，未截斷。` });
  }
  try {
    const current = snapshot(candidate, state.step + 1, learningMetrics(evaluate, candidate));
    return Object.freeze({ ...current, status: current.step === 500 ? 'complete' : 'ready', reason: '',
      history: Object.freeze([...state.history, current]) });
  } catch (error) {
    // The candidate failed evaluation: do not accept it or publish stale metrics.
    return Object.freeze({ ...state, loss: null, dAlpha: null, dB: null, maxError: null,
      status: 'stopped', reason: `停止：第 ${state.step + 1} 步候選 a=${candidate.alpha / 40}、b=${candidate.b}；${error.message} 保留上一組合法係數。` });
  }
}

export function runLearning(state, evaluate, learningRate = 0.05) {
  while (state.status === 'ready' && state.step < 500) state = stepLearning(state, evaluate, learningRate);
  return state;
}

export function bindLearningPage(document, evaluate, forward) {
  const el = id => document.getElementById(id);
  let state = startLearning(evaluate);
  const metricIDs = { step: 'count', a: 'a', b: 'b', loss: 'loss', dAlpha: 'gradient-alpha', dB: 'gradient-b', maxError: 'max-error' };
  function render() {
    for (const [key, id] of Object.entries(metricIDs)) el(`learning-${id}`).textContent = state[key] === null ? '—' : String(state[key]);
    const status = el('learning-status');
    status.dataset.state = state.status;
    status.textContent = state.reason || (state.status === 'complete'
      ? (state.maxError <= 0.05 ? '500 步完成：九點最大誤差 ≤ 0.05 °C。' : '500 步完成：未達九點最大誤差 ≤ 0.05 °C，沒有調整允差。')
      : `第 ${state.step} 步：可繼續學習；固定學習率 0.05。`);
    for (const id of ['learning-step', 'learning-run']) el(id).disabled = state.status !== 'ready';
    // Only finite numeric snapshots enter this table; error text uses textContent.
    el('learning-history').innerHTML = state.history.map(row => `<tr>${['step', 'a', 'b', 'loss', 'dAlpha', 'dB', 'maxError']
      .map(key => `<td>${row[key]}</td>`).join('')}</tr>`).join('');
  }
  function act(action) {
    state = action();
    forward.applyCoefficients(state);
    render();
  }
  el('learning-step').addEventListener('click', () => act(() => stepLearning(state, evaluate)));
  el('learning-run').addEventListener('click', () => act(() => runLearning(state, evaluate)));
  el('learning-reset').addEventListener('click', () => act(() => startLearning(evaluate)));
  el('learning-fast').addEventListener('click', () => act(() => runLearning(startLearning(evaluate), evaluate, 2)));
  render(); // Initial training state does not overwrite the HW-1 forward defaults.
}
