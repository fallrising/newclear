export function oneGrokTask(floor, model, prompt) {
  floor.project.agentProviders = ['grok'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  let used = false;
  floor.workers.spawn = (...args) => {
    if (used || args[2] !== prompt || args[3] || (args[4] && args[4] !== 'agent') ||
        (args[5] ?? floor.workers.officeDefault.provider) !== 'grok' ||
        args[6] !== model || args[7] || args[8] || args[9] || args[10]?.length || args[11]) return 'Only the fixed Grok fixture is allowed';
    used = true; return spawn(...args);
  };
  for (const method of ['resume', 'prompt', 'station', 'write', 'drop', 'rebuild']) floor.workers[method] = () => 'No additional task input allowed';
  floor.workers.wakeAll = () => {};
}
