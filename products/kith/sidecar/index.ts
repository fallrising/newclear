import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSidecarConfig } from "./config.ts";
import { runSidecar } from "./loop.ts";
import { defaultSpawn } from "./spawn.ts";
import { startupPathCheck } from "./paths.ts";

export { botTokenFromEnv, loadSidecarConfig, parseSidecarToml, sidecarConfigFromMap } from "./config.ts";
export type { SidecarConfig } from "./config.ts";
export {
  canonicalPath,
  inv14ExitCode,
  pairConflicts,
  pathsEqualOrNested,
  sameInode,
  startupPathCheck,
} from "./paths.ts";
export { buildPrompt, summarizeCliOutput, UNTRUSTED_ROOM_TRANSCRIPT } from "./prompt.ts";
export { assertArgvOmitsRoomBody, buildCodexArgv, defaultSpawn } from "./spawn.ts";
export {
  consumeEvents,
  initialAfterSeq,
  parseSseEvents,
  queryMaxSeq,
  runLiveSidecar,
  runSidecar,
  type ConsumeResult,
  type SidecarEvent,
} from "./loop.ts";
export { eventsUrl, mcpUrl, postStatusAccepted, postTrace, sendMessage } from "./mcp.ts";

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  return undefined;
}

export async function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const configPath = argValue(argv, "--config");
  if (!configPath) {
    process.stderr.write("usage: sidecar --config /path/to/sidecar.toml\n");
    return 1;
  }
  const config = loadSidecarConfig(configPath);
  const paths = startupPathCheck(config, env);
  if (!paths.ok) {
    process.stderr.write(`${paths.reason}\n`);
    return paths.exitCode;
  }
  if (argv.includes("--check-paths")) return 0;

  const maxRaw = env.KITH_MAX_SEQ;
  const maxSeq = maxRaw !== undefined && maxRaw !== "" ? Number(maxRaw) : undefined;
  await runSidecar({
    config,
    fetch: globalThis.fetch.bind(globalThis),
    spawn: defaultSpawn,
    env,
    maxSeq: Number.isFinite(maxSeq) ? maxSeq : undefined,
    live: !argv.includes("--once"),
  });
  return 0;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(entry);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    },
  );
}
