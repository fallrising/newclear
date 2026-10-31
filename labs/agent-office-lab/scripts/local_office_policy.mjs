// Policy for the synthetic demo floor; upstream source stays pinned and untouched.
export function localOnly(floor, model) {
  floor.project.agentProviders = ['opencode'];
  const spawn = floor.workers.spawn.bind(floor.workers);
  floor.workers.spawn = (...args) => {
    const provider = args[5] ?? floor.workers.officeDefault.provider;
    if (args[4] === 'shell' || provider !== 'opencode') return 'This demo only runs local OpenCode workers';
    if (args[3] || args[10]?.length) return 'This demo uses only its synthetic workspace';
    if (args[6] && args[6] !== model) return 'This demo only uses the local Strata model';
    return spawn(...args);
  };
}
