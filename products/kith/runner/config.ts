import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pairConflicts } from "../sidecar/paths.ts";
import type { QuotaClass } from "../src/quota.ts";
import { parseToml, type TomlTable, type TomlValue } from "./toml.ts";

export type AdapterKind = "codex" | "claude_code" | "gemini_cli" | "command";
export const ADAPTER_KINDS: readonly AdapterKind[] = ["codex", "claude_code", "gemini_cli", "command"];

export type RunnerConfig = {
  kith_url: string;
  bot_token_file: string;
  state_dir: string;
  quota_class: QuotaClass;
  operator_member_id: string | null;
  auth: "api_key" | "subscription";
  rooms: string[] | null; // null → discover with list_rooms every 60 s
  max_rooms: number;
  adapter: {
    kind: AdapterKind;
    executable: string;
    workdir: string;
    home: string | null;
    timeout_s: number;
    mode: string | null; // codex --sandbox / claude --permission-mode / gemini --approval-mode
    argv: string[]; // command only; fixed, never templated (ARGV-01)
  };
};

export class ConfigError extends Error {}

const TOP_KEYS = ["kith_url", "bot_token_file", "state_dir", "quota_class", "operator_member_id", "auth", "rooms", "max_rooms", "adapter"];
const ADAPTER_KEYS = ["kind", "executable", "workdir", "home", "timeout_s", "mode", "command"];
/** Allowed `mode` per adapter and its default: read-only unless the operator widens it (room text is untrusted). */
export const MODES: Record<Exclude<AdapterKind, "command">, { values: readonly string[]; default: string }> = {
  codex: { values: ["read-only", "workspace-write"], default: "read-only" },
  claude_code: { values: ["plan", "dontAsk", "acceptEdits"], default: "plan" },
  gemini_cli: { values: ["plan", "default", "auto_edit"], default: "plan" },
};
/** API-key variables each CLI reads; with auth = "subscription" any of them being set refuses start (RT-06). */
export const API_KEY_ENV: Record<AdapterKind, readonly string[]> = {
  codex: ["OPENAI_API_KEY", "CODEX_API_KEY"],
  claude_code: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  gemini_cli: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  command: [],
};
const FANZLOUD_ENV = ["CODEBOX_CODEX_HOME", "CODEBOX_WORKING_DIR", "CODEBOX_CODEX_EXECUTABLE"] as const;
const TOKEN_RE = /^kith_bot_[0-9a-f]{64}$/;
const ROOM_RE = /^[A-Za-z0-9_-]{1,64}$/;

function str(t: TomlTable, key: string, where: string, required: true): string;
function str(t: TomlTable, key: string, where: string, required: false): string | null;
function str(t: TomlTable, key: string, where: string, required: boolean): string | null {
  const v: TomlValue | undefined = t[key];
  if (v === undefined) {
    if (required) throw new ConfigError(`${where}${key} is required`);
    return null;
  }
  if (typeof v !== "string" || v === "") throw new ConfigError(`${where}${key} must be a non-empty string`);
  return v;
}

function absolute(p: string, key: string): string {
  if (!path.isAbsolute(p)) throw new ConfigError(`${key} must be an absolute path`);
  return path.normalize(p);
}

export function configFromToml(text: string, env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const t = parseToml(text);
  for (const key of Object.keys(t)) if (!TOP_KEYS.includes(key)) throw new ConfigError(`unknown key ${key}`);
  const adapter = t.adapter;
  if (!adapter || typeof adapter !== "object" || Array.isArray(adapter)) throw new ConfigError("[adapter] is required");
  for (const key of Object.keys(adapter)) if (!ADAPTER_KEYS.includes(key)) throw new ConfigError(`unknown key adapter.${key}`);

  const kithUrl = str(t, "kith_url", "", true).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(kithUrl);
  } catch {
    throw new ConfigError("kith_url is not a URL");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new ConfigError("kith_url must use https (http only for 127.0.0.1/localhost)");

  const quota = str(t, "quota_class", "", true);
  if (quota !== "api_key" && quota !== "operator_personal") throw new ConfigError("quota_class must be api_key or operator_personal");
  const operator = str(t, "operator_member_id", "", false);
  if (quota === "operator_personal" && !operator) throw new ConfigError("operator_member_id is required when quota_class = operator_personal (INV-13)");
  const auth = str(t, "auth", "", true);
  if (auth !== "api_key" && auth !== "subscription") throw new ConfigError('auth must be "api_key" or "subscription"');
  if (auth === "subscription" && quota !== "operator_personal") {
    throw new ConfigError("auth = subscription requires quota_class = operator_personal (RT-06)");
  }

  let rooms: string[] | null = null;
  if (t.rooms !== undefined) {
    if (!Array.isArray(t.rooms) || t.rooms.length === 0 || !t.rooms.every((r) => typeof r === "string" && ROOM_RE.test(r))) {
      throw new ConfigError("rooms must be a non-empty array of room ids");
    }
    rooms = t.rooms as string[];
  }
  const maxRooms = t.max_rooms === undefined ? 16 : t.max_rooms;
  if (typeof maxRooms !== "number" || !Number.isInteger(maxRooms) || maxRooms < 1 || maxRooms > 64) throw new ConfigError("max_rooms must be 1-64");

  const kind = str(adapter, "kind", "adapter.", true) as AdapterKind;
  if (!ADAPTER_KINDS.includes(kind)) throw new ConfigError(`adapter.kind must be one of ${ADAPTER_KINDS.join(", ")}`);
  const executable = absolute(str(adapter, "executable", "adapter.", true), "adapter.executable");
  const workdir = absolute(str(adapter, "workdir", "adapter.", true), "adapter.workdir");
  const homeRaw = str(adapter, "home", "adapter.", false);
  const home = homeRaw === null ? null : absolute(homeRaw, "adapter.home");
  if (kind !== "command" && home === null) throw new ConfigError("adapter.home is required for CLI adapters (RT-07)");
  const timeout = adapter.timeout_s === undefined ? 1800 : adapter.timeout_s;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 10 || timeout > 7200) throw new ConfigError("adapter.timeout_s must be 10-7200");
  let mode: string | null = null;
  if (kind !== "command") {
    const allowed = MODES[kind];
    mode = str(adapter, "mode", "adapter.", false) ?? allowed.default;
    if (!allowed.values.includes(mode)) throw new ConfigError(`adapter.mode for ${kind} must be one of ${allowed.values.join(", ")}`);
  } else if (adapter.mode !== undefined) {
    throw new ConfigError("adapter.mode is not used by the command adapter");
  }
  let argv: string[] = [];
  const command = adapter.command;
  if (kind === "command") {
    if (!command || typeof command !== "object" || Array.isArray(command) || !Array.isArray(command.argv)) {
      throw new ConfigError("[adapter.command] argv is required for kind = command");
    }
    if (!command.argv.every((a) => typeof a === "string")) throw new ConfigError("adapter.command.argv must be strings");
    argv = command.argv as string[];
  } else if (command !== undefined) {
    throw new ConfigError("[adapter.command] is only for kind = command");
  }

  const cfg: RunnerConfig = {
    kith_url: kithUrl,
    bot_token_file: absolute(str(t, "bot_token_file", "", true), "bot_token_file"),
    state_dir: absolute(str(t, "state_dir", "", true), "state_dir"),
    quota_class: quota,
    operator_member_id: operator,
    auth,
    rooms,
    max_rooms: maxRooms,
    adapter: { kind, executable, workdir, home, timeout_s: timeout, mode, argv },
  };
  checkEnvironment(cfg, env);
  return cfg;
}

/** RT-06 (declared auth vs. API-key variables) and RT-07 / INV-14 (disjoint paths). */
export function checkEnvironment(cfg: RunnerConfig, env: NodeJS.ProcessEnv): void {
  if (cfg.auth === "subscription") {
    const set = API_KEY_ENV[cfg.adapter.kind].filter((k) => (env[k] ?? "") !== "");
    if (set.length > 0) throw new ConfigError(`auth = subscription but ${set.join(", ")} is set; unset it or declare auth = api_key (RT-06)`);
  }
  const mine: Array<[string, string]> = [
    ["adapter.workdir", cfg.adapter.workdir],
    ["state_dir", cfg.state_dir],
    ["adapter.executable", cfg.adapter.executable],
  ];
  if (cfg.adapter.home) mine.push(["adapter.home", cfg.adapter.home]);
  for (let i = 0; i < mine.length; i++) {
    for (let j = i + 1; j < mine.length; j++) {
      const [ka, a] = mine[i]!;
      const [kb, b] = mine[j]!;
      if (pairConflicts(a, b)) throw new ConfigError(`${ka} and ${kb} must not be equal or nested (RT-07)`);
    }
  }
  for (const key of FANZLOUD_ENV) {
    const other = env[key];
    if (!other) continue;
    for (const [k, p] of mine) if (pairConflicts(p, other)) throw new ConfigError(`${k} intersects ${key} (INV-14)`);
  }
  if (!existsSync(cfg.adapter.executable)) throw new ConfigError("adapter.executable does not exist");
  try {
    accessSync(cfg.adapter.executable, constants.X_OK);
  } catch {
    throw new ConfigError("adapter.executable is not executable");
  }
  if (!existsSync(cfg.adapter.workdir) || !statSync(cfg.adapter.workdir).isDirectory()) throw new ConfigError("adapter.workdir must be an existing directory");
}

/** The token file must be private (0600 or stricter) and hold exactly one bot token. */
export function readBotToken(file: string): string {
  let st;
  try {
    st = statSync(file);
  } catch {
    throw new ConfigError("bot_token_file does not exist");
  }
  if ((st.mode & 0o077) !== 0) throw new ConfigError("bot_token_file must not be readable by group or others (chmod 600)");
  const token = readFileSync(file, "utf8").trim();
  if (!TOKEN_RE.test(token)) throw new ConfigError("bot_token_file does not contain a Kith bot token");
  return token;
}
