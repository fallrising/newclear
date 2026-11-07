// Read-only startup: no prompt, terminal input, session reuse or extra worker.
export function cursorStartupOnly(floor) {
  floor.project.agentProviders = ['cursor'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  let used = false;
  floor.workers.spawn = (...args) => {
    if (used || args[2] || args[3] || (args[4] && args[4] !== 'agent') ||
        (args[5] ?? floor.workers.officeDefault.provider) !== 'cursor' ||
        args[6] || args[7] || args[8] || args[9] || args[10]?.length || args[11]) {
      return 'Only one fresh Cursor startup without a prompt is allowed';
    }
    used = true; args[5] = 'cursor';
    return spawn(...args);
  };
  for (const method of ['resume', 'prompt', 'station', 'write', 'drop', 'rebuild']) {
    floor.workers[method] = () => 'Cursor startup does not accept input or resume';
  }
  floor.workers.wakeAll = () => {};
}
