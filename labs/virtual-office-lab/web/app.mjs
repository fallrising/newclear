import {present} from './presentation.mjs';
let snapshot; let lastSuccess; let timer; let active; let resume = false; let failures = 0;
const connection = document.querySelector('#connection');
const updated = document.querySelector('#last-success');
const agents = document.querySelector('#agents');
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function render(connected) {
  if (!snapshot) { connection.textContent = '連線中斷：尚無資料'; return; }
  const view = present(snapshot, {connected});
  connection.textContent = view.banner;
  updated.textContent = `上次成功：${lastSuccess}`;
  agents.replaceChildren(...view.bots.map(bot => {
    const item = document.createElement('li');
    if (bot.alert) item.className = 'alert';
    item.append(text('h2', bot.name), text('p', `${bot.role} · ${bot.label}`), text('p', bot.summary), text('p', bot.badges.join(' · ')));
    return item;
  }));
}
async function poll() {
  if (document.hidden || active) return;
  clearTimeout(timer);
  const controller = new AbortController(); active = controller;
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch('/state', {signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error'});
    if (!response.ok) throw new Error('state unavailable');
    const candidate = await response.json();
    present(candidate); // Validate before replacing the last known good snapshot.
    snapshot = candidate; lastSuccess = new Date().toISOString(); failures = 0; render(true);
  } catch { if (controller.signal.reason !== 'hidden') { failures++; render(false); } }
  finally {
    clearTimeout(timeout); active = undefined;
    if (!document.hidden) timer = setTimeout(poll, resume ? 0 : Math.min(60000, 15000 * 2 ** Math.min(failures, 2)) + (failures < 2 ? Math.random() * 1000 : 0));
    resume = false;
  }
}
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (document.hidden) active?.abort('hidden'); else if (active) resume = true; else poll();
});
poll();
