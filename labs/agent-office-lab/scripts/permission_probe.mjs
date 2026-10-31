// Passive native hook/screen observer. It never synthesizes Office statuses.
export function observePermissions(workers, probe, onError) {
  // The HTTP hook router calls this generic entrypoint, not handleOpenCodeHook.
  const native = workers.handleProviderHook.bind(workers);
  workers.handleProviderHook = (route, id, token, event, payload) => {
    const accepted = native(route, id, token, event, payload);
    if (route === 'opencode') {
      try { probe.hook(id, payload, accepted); } catch (error) { onError(error); }
    }
    return accepted;
  };
}

export class PermissionProbe {
  constructor() {
    this.pending = undefined;
    this.requests = [];
    this.usageEvents = [];
    this.lines = new Map();
  }
  hook(workerId, event, accepted) {
    if (!accepted || !event || typeof event.sessionId !== 'string') return;
    if (event.type === 'usage') {
      this.usageEvents.push({ workerId, sessionId: event.sessionId, output: event.usage?.output });
      return;
    }
    if (event.type === 'permission' && event.status === 'needs_input') {
      if (!['edit', 'bash'].includes(event.detail)) throw new Error('Unexpected permission in synthetic acceptance');
      if (this.pending) throw new Error('Overlapping permission requests are not auto-answered');
      this.pending = { workerId, sessionId: event.sessionId, kind: event.detail, replied: false, continued: false };
      this.requests.push(this.pending);
    } else if (this.pending && this.pending.workerId === workerId && this.pending.sessionId === event.sessionId) {
      if (event.type === 'error') throw new Error('Native provider reported an error');
      if (event.status === 'working' || event.status === 'done') {
        if (!this.pending.replied) throw new Error('Permission advanced before the acceptance reply');
        this.pending.continued = true;
        this.pending = undefined;
      }
    }
  }
  screen(message) {
    if (message.t !== 'screen') return;
    let lines = this.lines.get(message.workerId);
    if (message.full || !lines) this.lines.set(message.workerId, lines = new Map());
    for (const [row, runs] of Object.entries(message.lines)) lines.set(Number(row), runs.map(r => r[0]).join(''));
  }
  ready(worker) {
    const p = this.pending;
    if (!p || p.replied || worker?.status !== 'needs_input' || worker.id !== p.workerId || worker.sessionId !== p.sessionId) return false;
    const screen = this.text(worker.id);
    return screen.includes('Permission required') && screen.includes('Allow once') && screen.includes('Reject');
  }
  text(workerId) {
    return [...(this.lines.get(workerId)?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map(([, line]) => line).join('\n');
  }
  reply(worker) {
    if (!this.ready(worker)) throw new Error('No matching native permission prompt');
    this.pending.replied = true;
    return { t: 'term.input', workerId: worker.id, data: '\r' };
  }
  summary() {
    return this.requests.map(({ kind, replied, continued }) => ({ kind, replied, continued }));
  }
}
