// Adapter for the pinned Office WorkerManager. No upstream files are modified.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';

const ACTIVE = new Set(['starting', 'running', 'waiting_input']);
const STATES = new Set([...ACTIVE, 'idle', 'completed', 'interrupted', 'failed']);
const installed = new WeakSet();
const CONTINUE = 'Continue the interrupted task in this session. If a permission was pending, ask again.';

// OpenCode 1.19.5 only auto-submits --prompt on its home route, not --session.
// An explicit resume queues one native PTY prompt after authenticated history and a fresh TUI.
export class ResumeContinuation {
  constructor(send, fail) { this.pending = new Map(); this.send = send; this.fail = fail; }
  queue(worker, text) {
    this.cancel(worker.info.id);
    const entry = { worker, text, sessionId: worker.info.sessionId, hydrated: false };
    entry.timer = setTimeout(() => {
      this.cancel(worker.info.id); this.fail(worker, 'Resume terminal was not ready within 30 seconds');
    }, 30000);
    entry.timer.unref();
    this.pending.set(worker.info.id, entry);
  }
  cancel(id) {
    clearTimeout(this.pending.get(id)?.timer); this.pending.delete(id);
  }
  clear() { for (const id of this.pending.keys()) this.cancel(id); }
  hook(worker, event, accepted) {
    const entry = worker && this.pending.get(worker.info.id);
    if (!entry || !accepted || event?.sessionId !== entry.sessionId) return;
    if (['working', 'needs_input', 'done'].includes(event.status) || event.type === 'error') {
      this.cancel(worker.info.id); return; // Another input/action already took over; never double-submit.
    }
    if (event.type === 'usage') { entry.hydrated = true; this.screen(worker); }
  }
  screen(worker) {
    const entry = this.pending.get(worker.info.id);
    if (!entry || !entry.hydrated || !worker.pty || worker.info.status !== 'idle' || !worker.term) return;
    if (worker.info.sessionId !== entry.sessionId) { this.cancel(worker.info.id); return; }
    const buffer = worker.term.buffer.active;
    const from = buffer.type === 'normal' ? Math.max(buffer.baseY, worker.fresh?.line ?? 0) : buffer.baseY;
    const text = Array.from({ length: worker.term.rows }, (_, row) => buffer.getLine(from + row)?.translateToString(true) ?? '').join('\n');
    if (!text.includes('ctrl+p') || !text.includes('Qwen3.8') || text.includes('Permission required')) return;
    this.cancel(worker.info.id);
    const error = this.send(worker.info.id, entry.text);
    if (error) this.fail(worker, error);
  }
}

export function taskState(worker) {
  const { info } = worker;
  if (info.status === 'working') return 'running';
  if (info.status === 'needs_input') return 'waiting_input';
  if (info.status === 'done') return 'completed';
  if (info.status === 'starting') return 'starting';
  if (['offline', 'exited'].includes(info.status)) return info.labTaskState ?? (worker.interrupted ? 'interrupted' : 'idle');
  return info.labTaskState === 'starting' || (info.prompt && !info.sessionId) ? 'starting' : 'idle';
}

export class RecoveryJournal {
  constructor(file) {
    this.file = file;
    this.records = new Map();
    if (!existsSync(file)) return;
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert(saved.version === 1 && Array.isArray(saved.workers), 'Invalid recovery journal');
    for (const row of saved.workers) {
      assert(typeof row.id === 'string' && row.id && STATES.has(row.state) && !this.records.has(row.id), 'Invalid recovery record');
      assert(row.sessionId === undefined || typeof row.sessionId === 'string', 'Invalid saved session');
      assert(row.task === undefined || (typeof row.task.name === 'string' && typeof row.task.summary === 'string'), 'Invalid saved task');
      this.records.set(row.id, row);
    }
  }
  capture(workers, interrupt = false) {
    const rows = [];
    for (const worker of workers.values()) {
      const { info } = worker;
      let state = taskState(worker);
      if (interrupt && ACTIVE.has(state)) state = 'interrupted';
      const previous = this.records.get(info.id);
      rows.push({ id: info.id, state, sessionId: info.sessionId,
        task: info.labTaskState === 'interrupted' ? previous?.task : info.task });
      info.labTaskState = state;
    }
    const temporary = this.file + '.tmp';
    writeFileSync(temporary, JSON.stringify({ version: 1, workers: rows }, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, this.file);
    this.records = new Map(rows.map(row => [row.id, row]));
  }
  restore(worker) {
    const row = this.records.get(worker.info.id);
    const state = worker.interrupted ? 'interrupted' : (row?.state ?? 'idle');
    if (!row) this.records.set(worker.info.id, { id: worker.info.id, state, task: worker.info.task, sessionId: worker.info.sessionId });
    worker.info.labTaskState = ACTIVE.has(state) ? 'interrupted' : state;
    worker.interrupted = worker.info.labTaskState === 'interrupted';
    if (row?.task) worker.info.task = row.task;
    park(worker);
  }
}

function park(worker) {
  worker.info.status = 'offline';
  worker.info.acked = true;
  if (worker.info.labTaskState === 'interrupted') {
    worker.info.activity = 'interrupted — resume manually';
    const name = worker.info.task?.name ?? 'Task';
    worker.info.task = { name: name.startsWith('interrupted · ') ? name : `interrupted · ${name}`, summary: worker.info.activity };
    worker.interrupted = true;
  }
}

async function stopAdopted(adopted) {
  if (!adopted) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Old owned PTY did not exit within 10 seconds')), 10000);
    adopted.pty.onExit(() => { clearTimeout(timer); resolve(); });
    adopted.pty.kill();
  });
}

export function installManualRecovery(WorkerManager, workspace, model) {
  if (installed.has(WorkerManager)) return;
  installed.add(WorkerManager);
  const nativeStart = WorkerManager.prototype.start;
  WorkerManager.prototype.start = async function () {
    // Private field compatibility is deliberately checked against the fixed upstream version.
    assert(this.dir === workspace && this.workers instanceof Map && this.host && this.statePath, 'Unsupported Office recovery scope/version');
    const nativePersist = this.persist.bind(this);
    const nativeShutdown = this.shutdown.bind(this);
    try {
      if (existsSync(this.statePath)) assert(Array.isArray(JSON.parse(readFileSync(this.statePath, 'utf8'))), 'Invalid native worker state');
      const journal = new RecoveryJournal(path.join(path.dirname(this.statePath), 'lab-recovery.json'));
      for (const id of journal.records.keys()) assert(this.workers.has(id), 'Recovery journal has a missing native worker');
      for (const worker of this.workers.values()) journal.restore(worker);
      this.persist = () => { journal.capture(this.workers); nativePersist(); };
      const continuation = new ResumeContinuation((id, text) => this.prompt(id, text), (worker, error) => {
        worker.info.labTaskState = 'interrupted'; worker.interrupted = true;
        worker.pty?.kill();
        park(worker); this.emitUpdate(worker);
        this.events.toast(error, 'warn'); this.persist();
      });
      const nativeHook = this.handleProviderHook.bind(this);
      this.handleProviderHook = (route, id, token, event, payload) => {
        const accepted = nativeHook(route, id, token, event, payload);
        if (route === 'opencode') continuation.hook(this.workers.get(id), payload, accepted);
        return accepted;
      };
      const nativeCheck = this.checkBlocked.bind(this);
      this.checkBlocked = worker => { nativeCheck(worker); continuation.screen(worker); };
      // Normal shutdown must preserve unfinished work before the native stopping flag clears it.
      this.shutdown = () => {
        continuation.clear();
        journal.capture(this.workers, true);
        this.persist = nativePersist;
        return nativeShutdown(false);
      };
      const nativeAttach = this.host.attach.bind(this.host);
      this.host.attach = async id => { await stopAdopted(await nativeAttach(id)); return undefined; };
      this.wakeAll = () => {}; // Only an explicit resume may launch a restored worker.
      this.host.onLost = () => this.events.toast('Terminal host stopped — resume interrupted tasks manually', 'warn');
      const nativeResume = this.resume.bind(this);
      this.resume = (id, prompt) => {
        const worker = this.workers.get(id);
        if (!worker) return 'No such worker';
        const { info } = worker;
        if (worker.pty || worker.dsh) return 'Worker is already running';
        // Native onExit(lost) also calls resume. It still has its live status, unlike a manual
        // resume from an offline/exited desk: park it instead of automatically relaunching.
        if (!['offline', 'exited'].includes(info.status)) {
          if (ACTIVE.has(taskState(worker))) info.labTaskState = 'interrupted';
          journal.capture(this.workers, true);
          park(worker); this.emitUpdate(worker); this.persist();
          return 'Interrupted — resume manually';
        }
        if (info.kind !== 'agent' || info.provider !== 'opencode' || info.model !== model || info.worktree || info.repos?.length) return 'Only the local synthetic OpenCode session may resume';
        if (info.labTaskState === 'interrupted' && !info.sessionId) return 'Interrupted task has no saved session; submit a new task';
        const previous = journal.records.get(id);
        if (previous?.task) info.task = previous.task;
        const deferred = info.sessionId && (prompt || (worker.interrupted ? CONTINUE : undefined));
        if (deferred) worker.interrupted = false;
        info.labTaskState = 'starting';
        const error = nativeResume(id, deferred ? undefined : prompt);
        if (error) { journal.restore(worker); this.emitUpdate(worker); }
        else if (deferred) continuation.queue(worker, deferred);
        this.persist();
        return error;
      };
      await nativeStart.call(this);
      for (const worker of this.workers.values()) this.emitUpdate(worker);
      this.persist();
    } catch (error) {
      // Do not let a failed startup leave detached terminals or timers running.
      this.persist = () => {}; // Preserve corrupt evidence instead of overwriting it.
      nativeShutdown(false);
      throw error;
    }
  };
}
