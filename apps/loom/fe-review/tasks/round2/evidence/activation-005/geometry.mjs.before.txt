/** Serializable bounded observer; reads geometry only, never changes focus or DOM. */
export async function observeStableHandles() {
  const read = () => {
    const bounds = (element) => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const handle = (selector) => {
      const element = document.querySelector(selector), box = bounds(element);
      const hit = box ? document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) : null;
      return { box, centerHit: !!element && (hit === element || element.contains(hit)), hitTag: hit?.tagName ?? null, hitHandle: hit?.closest('[data-handleid]')?.getAttribute('data-handleid') ?? null, hitNode: hit?.closest('.react-flow__node')?.getAttribute('data-id') ?? null };
    };
    const canvas = window.__LOOM_REVIEW__.exportSeed().canvas;
    return { transform: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null, source: handle('.react-flow__node-document [data-handleid="out"]'), target: handle('.react-flow__node-terminal [data-handleid="in"]'), document: bounds(document.querySelector('.react-flow__node-document')), terminal: bounds(document.querySelector('.react-flow__node-terminal')), domEdges: document.querySelectorAll('.react-flow__edge').length, persistedEdges: canvas?.edges.length ?? null, canvasWrites: window.__LOOM_REVIEW__.snapshot().counts.canvas_write ?? 0 };
  };
  const samples = []; let previous = null, stableFrames = 0;
  for (let frame = 0; frame < 90; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const current = read();
    const key = JSON.stringify({ transform: current.transform, source: current.source.box, target: current.target.box });
    stableFrames = key === previous ? stableFrames + 1 : 0; previous = key;
    samples.push(current);
    if (stableFrames >= 3 && current.source.box && current.target.box) return { stable: true, frames: frame + 1, stableFrames, first: samples[0], last: current };
  }
  return { stable: false, frames: samples.length, stableFrames, first: samples[0], last: samples.at(-1) };
}
