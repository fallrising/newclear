#!/usr/bin/env node
// kith-runner: node runner/main.ts --config /path/runner.toml [--check]
// Exit codes: 0 stopped (SIGINT/SIGTERM) or --check ok · 2 configuration · 3 token rejected (401) · 1 other.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AuthError, KithClient } from "./client.ts";
import { ConfigError, configFromToml, readBotToken } from "./config.ts";
import { defaultSpawn } from "./process.ts";
import { Runner } from "./runner.ts";
import { RunnerState } from "./state.ts";

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const i = argv.indexOf("--config");
  const file = i >= 0 ? argv[i + 1] : undefined;
  if (!file) {
    process.stderr.write("usage: kith-runner --config /path/runner.toml [--check]\n");
    return 2;
  }
  let cfg;
  let token: string;
  try {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new ConfigError(`cannot read ${file}`);
    }
    cfg = configFromToml(text, env);
    token = readBotToken(cfg.bot_token_file);
  } catch (e) {
    log("config_error", { message: e instanceof Error ? e.message : String(e) });
    return e instanceof ConfigError || (e as Error).name === "TomlError" ? 2 : 1;
  }
  if (argv.includes("--check")) {
    log("config_ok", { adapter: cfg.adapter.kind });
    return 0;
  }
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  const runner = new Runner({
    cfg,
    client: new KithClient(cfg.kith_url, token, fetch),
    state: new RunnerState(cfg.state_dir),
    spawn: defaultSpawn,
    env,
    log,
    signal: controller.signal,
  });
  try {
    await runner.run();
    log("stopped");
    return 0;
  } catch (e) {
    if (e instanceof AuthError) {
      log("stopped", { reason: "token_rejected" });
      return 3;
    }
    log("crashed", { message: e instanceof Error ? e.message : String(e) });
    return 1;
  }
}

const entry = process.argv[1];
// `file://${argv}` does not match import.meta.url when the path is relative (`node runner/main.ts`).
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
