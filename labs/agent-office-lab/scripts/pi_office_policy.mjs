// One fresh synthetic task only; subsequent prompts, resume and extra workers are disabled.
export function onePiTask(floor) {
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
  floor.workers.resume = () => 'This bounded acceptance does not resume sessions';
  floor.workers.prompt = () => 'This bounded acceptance does not accept additional prompts';
  floor.workers.wakeAll = () => {};
}
