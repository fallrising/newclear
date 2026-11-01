// Read-only startup: no prompt, terminal input, session reuse or extra worker.
export function grokStartupOnly(floor) {
  floor.project.agentProviders = ['grok'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  let used = false;
  floor.workers.spawn = (...args) => {
    if (used || args[2] || args[3] || (args[4] && args[4] !== 'agent') ||
        (args[5] ?? floor.workers.officeDefault.provider) !== 'grok' ||
        args[6] || args[7] || args[8] || args[9] || args[10]?.length || args[11]) {
      return 'Only one fresh Grok startup without a prompt is allowed';
    }
    used = true; args[5] = 'grok';
    return spawn(...args);
  };
  for (const method of ['resume', 'prompt', 'station', 'write', 'drop', 'rebuild']) {
    floor.workers[method] = () => 'Grok startup does not accept input or resume';
  }
  floor.workers.wakeAll = () => {};
}
