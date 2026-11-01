import fs from 'node:fs';
import path from 'node:path';

export function permittedTool(workspace, toolName, input) {
  const name = toolName === 'read' ? 'input.json' : toolName === 'write' ? 'result.json' : undefined;
  if (!name || typeof input?.path !== 'string') return false;
  const target = path.resolve(workspace, input.path);
  if (target !== path.join(workspace, name)) return false;
  try {
    if (!fs.lstatSync(target).isFile() || fs.realpathSync(target) !== target) return false;
  } catch (error) { if (error.code !== 'ENOENT') return false; }
  if (toolName === 'write' && (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 4096)) return false;
  return true;
}

export default function (pi) {
  const out = process.env.LAB_PI_OUT;
  const workspace = process.env.LAB_PI_WORKSPACE;
  if (!out || !workspace) throw new Error('Missing synthetic Pi scope');
  const emit = (type, ctx, extra = {}) => fs.appendFileSync(path.join(out, 'pi-events.jsonl'),
    JSON.stringify({ type, session: ctx.sessionManager.getSessionId(), provider: ctx.model?.provider,
      model: ctx.model?.id, ...extra }) + '\n', { mode: 0o600 });
  pi.on('session_start', (_e, ctx) => emit('session_start', ctx));
  pi.on('tool_call', (e, ctx) => {
    const allowed = permittedTool(workspace, e.toolName, e.input);
    emit('tool_call', ctx, { tool: e.toolName, allowed });
    if (!allowed) return { block: true, reason: 'Only reading input.json and writing result.json in the synthetic workspace is allowed' };
  });
  pi.on('message_end', (e, ctx) => {
    if (e.message.role === 'assistant') emit('assistant_end', ctx, { stopReason: e.message.stopReason,
      output: e.message.usage?.output ?? null });
  });
  pi.on('agent_settled', (_e, ctx) => emit('agent_settled', ctx));
}
