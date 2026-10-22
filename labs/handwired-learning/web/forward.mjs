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
}
