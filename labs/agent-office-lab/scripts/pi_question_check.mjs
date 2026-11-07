import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const lab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function privateDirectory(dir) {
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(dir) !== dir
      || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error('unsafe question directory');
}

function appendEvent(out, event) {
  privateDirectory(out);
  const fd = fs.openSync(path.join(out, 'question-events.jsonl'),
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const st = fs.fstatSync(fd), data = JSON.stringify(event) + '\n';
    if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o077)
        || st.size + Buffer.byteLength(data) > 65536) throw new Error('unsafe question events');
    fs.writeFileSync(fd, data);
  } finally { fs.closeSync(fd); }
}

function validateScope() {
  if (process.env.LAB_PI_QUESTION_MODE !== '1') throw new Error('question mode disabled');
  const nonce = process.env.LAB_PI_QUESTION_NONCE;
  if (!/^[0-9a-f]{32}$/.test(nonce || '')) throw new Error('invalid question nonce');
  const out = path.resolve(process.env.LAB_PI_OUT || '');
  const workspace = path.resolve(process.env.LAB_PI_WORKSPACE || '');
  if (!out.startsWith(path.join(lab, 'runs') + path.sep)) throw new Error('invalid question out');
  if (workspace !== path.join(out, 'workspace')) throw new Error('invalid question workspace');
  if (path.resolve(process.cwd()) !== workspace) throw new Error('invalid question cwd');
  privateDirectory(out); privateDirectory(workspace);
  return { out, workspace, nonce };
}

function eventBase(ctx) {
  const session = ctx?.sessionManager?.getSessionId?.() ?? ctx?.sessionId;
  return { session, provider: ctx?.model?.provider, model: ctx?.model?.id };
}

function ensurePrivateQuestionDir(out) {
  const dir = path.join(out, 'question');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  privateDirectory(dir);
  return dir;
}

export default function questionCheck(pi) {
  const scope = validateScope();
  let ran = false;
  pi.on('before_provider_request', (_event, ctx) => {
    appendEvent(scope.out, { type: 'provider_request_attempt', ...eventBase(ctx) });
    throw new Error('native question check must not request a provider');
  });
  pi.registerCommand('lab-office-question', {
    description: 'Run the Agent Office native question lifecycle check',
    async handler(args = [], ctx) {
      if (ran) {
        appendEvent(scope.out, { type: 'command_rejected', ...eventBase(ctx) });
        return;
      }
      ran = true;
      if ((Array.isArray(args) && args.length) || (!Array.isArray(args) && args != null && String(args).trim())) {
        appendEvent(scope.out, { type: 'command_rejected', ...eventBase(ctx) });
        return;
      }
      if (ctx?.hasUI !== true || !ctx?.ui?.confirm) {
        appendEvent(scope.out, { type: 'command_rejected', ...eventBase(ctx) });
        throw new Error('question UI unavailable');
      }
      const base = eventBase(ctx);
      if (typeof base.session !== 'string' || !base.session || base.provider !== 'deepseek' || base.model !== 'deepseek-flash') throw new Error('invalid question session/model');
      appendEvent(scope.out, { type: 'detector_installed', ...eventBase(ctx) });
      const dir = ensurePrivateQuestionDir(scope.out);
      const values = [];
      const prompts = [
        { index: 0, title: 'Synthetic deny check', message: 'Select No or press Escape.', timeout: 10000 },
        { index: 1, title: 'Synthetic allow check', message: 'Select Yes or press Enter.', timeout: 10000 },
        { index: 2, title: 'Synthetic timeout check', message: 'Do not answer; this prompt times out.', timeout: 2000 },
      ];
      for (const prompt of prompts) {
        appendEvent(scope.out, { type: 'confirm_start', ...eventBase(ctx), index: prompt.index });
        const ui = await ctx.ui.confirm(prompt.title, prompt.message, { timeout: prompt.timeout });
        if (typeof ui !== 'boolean') throw new Error('unexpected question response type');
        const value = ui;
        values.push(value);
        appendEvent(scope.out, { type: 'confirm_result', ...eventBase(ctx), index: prompt.index, ui: value });
        if (value !== (prompt.index === 1)) throw new Error('unexpected question responses');
        if (prompt.index === 1 && value === true) {
          privateDirectory(scope.out); privateDirectory(dir);
          const marker = { schema: 'lab.pi.question.v1', session: eventBase(ctx).session, index: 1, nonce: scope.nonce };
          const markerPath = path.join(dir, 'allow-marker.json');
          const fd = fs.openSync(markerPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
          try {
            const data = JSON.stringify(marker), st = fs.fstatSync(fd);
            if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid() || Buffer.byteLength(data) > 512 || (st.mode & 0o077)) throw new Error('unsafe question marker');
            fs.writeFileSync(fd, data);
          } finally { fs.closeSync(fd); }
          appendEvent(scope.out, { type: 'marker_written', ...eventBase(ctx), index: 1 });
        }
      }
      if (values.length !== 3 || values[0] !== false || values[1] !== true || values[2] !== false) {
        appendEvent(scope.out, { type: 'command_rejected', ...eventBase(ctx) });
        throw new Error('unexpected question responses');
      }
      appendEvent(scope.out, { type: 'command_complete', ...eventBase(ctx) });
    },
  });
}
