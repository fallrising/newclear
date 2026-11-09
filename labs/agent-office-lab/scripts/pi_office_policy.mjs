// One fresh synthetic task only; subsequent prompts, resume and extra workers are disabled.
import { installPiHookGuard } from './pi_hook_guard.mjs';

export const PI_FIXTURE_MODEL = 'deepseek/deepseek-flash';

export function onePiTask(floor, {allowReconnect = false, allowRestoredReconnect = false} = {}) {
  const model = PI_FIXTURE_MODEL;
  const hookGuard = installPiHookGuard(floor.workers, { model });
  floor.project.agentProviders = ['pi'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  let used = (floor.workers.workers?.size ?? 0) > 0;
  floor.workers.spawn = (...args) => {
    if (used || args[4] === 'shell' || (args[5] ?? floor.workers.officeDefault.provider) !== 'pi') return 'Only one Pi fixture task is allowed';
    if (args[3] || args[10]?.length || (args[6] && args[6] !== model)) return 'Only the fixed DeepSeek fixture is allowed';
    args[5] = 'pi'; args[6] = model;
    used = true;
    const result = spawn(...args);
    const id = result?.id;
    if (typeof id === 'string' && floor.workers.workers?.has(id)) hookGuard.expectFresh(id);
    return result;
  };
  const nativeResume = floor.workers.resume?.bind(floor.workers);
  let permit, armed = false;
  const eligible = (id, session) => {
    const w = floor.workers.workers?.get(id);
    return w && w.info.id === id && w.info.kind === 'agent' && w.info.provider === 'pi'
      && w.info.model === model && w.info.sessionId === session && (w.info.status === 'exited' && !w.interrupted
        || allowRestoredReconnect && w.info.status === 'offline' && w.info.labTaskState === 'interrupted' && w.interrupted)
      && !w.pty && !w.dsh;
  };
  floor.workers.resume = (id, prompt) => {
    if (!permit || permit.id !== id || prompt !== undefined || !eligible(id, permit.session))
      return 'Only the explicitly armed Pi session may reconnect without a prompt';
    const session = permit.session;
    permit = undefined; // Consume before native launch; failures never auto-retry.
    hookGuard.expectReconnect(id, session);
    return nativeResume(id);
  };
  floor.workers.prompt = () => 'This bounded acceptance does not accept additional prompts';
  floor.workers.wakeAll = () => {};
  return {hookGuard, armReconnect(id, session) {
    if (!allowReconnect || armed || !nativeResume || typeof session !== 'string' || !session || !eligible(id, session))
      return false;
    armed = true; permit = {id, session}; return true;
  }};
}
