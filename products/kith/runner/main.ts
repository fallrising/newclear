#!/usr/bin/env node
// kith-runner: node runner/main.ts --config /path/runner.toml [--check]
// Exit codes: 0 stopped (SIGINT/SIGTERM) or --check ok · 2 configuration · 3 token rejected (401) · 1 other.
// The room loop (client, events, state) is W6-T08. This entry loads config and serves --check.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ConfigError, configFromToml, readBotToken } from "./config.ts";

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
  try {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new ConfigError(`cannot read ${file}`);
    }
    cfg = configFromToml(text, env);
    readBotToken(cfg.bot_token_file);
  } catch (e) {
    log("config_error", { message: e instanceof Error ? e.message : String(e) });
    return e instanceof ConfigError || (e as Error).name === "TomlError" ? 2 : 1;
  }
  if (argv.includes("--check")) {
    log("config_ok", { adapter: cfg.adapter.kind });
    return 0;
  }
  log("config_error", { message: "runner event loop is not built yet" });
  return 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2), process.env).then((code) => process.exit(code));
}
