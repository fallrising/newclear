// One fresh synthetic task only; subsequent prompts, resume and extra workers are disabled.
export function onePiTask(floor, {allowReconnect = false} = {}) {
  const model = 'deepseek/deepseek-flash';
  floor.project.agentProviders = ['pi'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  let used = false;
  floor.workers.spawn = (...args) => {
    if (used || args[4] === 'shell' || (args[5] ?? floor.workers.officeDefault.provider) !== 'pi') return 'Only one Pi fixture task is allowed';
    if (args[3] || args[10]?.length || (args[6] && args[6] !== model)) return 'Only the fixed DeepSeek fixture is allowed';
    args[5] = 'pi'; args[6] = model;
    used = true;
    return spawn(...args);
  };
  const nativeResume = floor.workers.resume?.bind(floor.workers);
  let permit, armed = false;
  const eligible = (id, session) => {
    const w = floor.workers.workers?.get(id);
    return w && w.info.id === id && w.info.kind === 'agent' && w.info.provider === 'pi'
      && w.info.model === model && w.info.sessionId === session && w.info.status === 'exited'
      && !w.pty && !w.dsh && !w.interrupted;
  };
  floor.workers.resume = (id, prompt) => {
    if (!permit || permit.id !== id || prompt !== undefined || !eligible(id, permit.session))
      return 'Only the explicitly armed Pi session may reconnect without a prompt';
    permit = undefined; // Consume before native launch; failures never auto-retry.
    return nativeResume(id);
  };
  floor.workers.prompt = () => 'This bounded acceptance does not accept additional prompts';
  floor.workers.wakeAll = () => {};
  return {armReconnect(id, session) {
    if (!allowReconnect || armed || !nativeResume || typeof session !== 'string' || !session || !eligible(id, session))
      return false;
    armed = true; permit = {id, session}; return true;
  }};
}
