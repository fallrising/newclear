import { readFileSync } from "node:fs";
import path from "node:path";
import type { QuotaClass } from "../src/quota.ts";

export type SidecarConfig = {
  agent_handle: string;
  room_id: string;
  operator_member_id: string;
  quota_class: QuotaClass;
  codex_home: string;
  workspace: string;
  executable: string;
  mcp_base_url: string;
};

const REQUIRED = [
  "agent_handle",
  "room_id",
  "operator_member_id",
  "codex_home",
  "workspace",
  "executable",
  "mcp_base_url",
] as const;

export function parseSidecarToml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function pick(map: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const v = map[name];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

export function sidecarConfigFromMap(map: Record<string, string>): SidecarConfig {
  const aliased: Record<string, string> = { ...map };
  const handle = pick(map, ["agent_handle", "handle"]);
  const exec = pick(map, ["executable", "codex_executable"]);
  const base = pick(map, ["mcp_base_url", "mcp_url"]);
  if (handle) aliased.agent_handle = handle;
  if (exec) aliased.executable = exec;
  if (base) aliased.mcp_base_url = base;

  for (const key of REQUIRED) {
    if (!aliased[key]) throw new Error(`sidecar.toml missing ${key}`);
  }

  const quotaRaw = aliased.quota_class ?? "operator_personal";
  if (quotaRaw !== "api_key" && quotaRaw !== "operator_personal") {
    throw new Error(`invalid quota_class: ${quotaRaw}`);
  }

  const config: SidecarConfig = {
    agent_handle: aliased.agent_handle!,
    room_id: aliased.room_id!,
    operator_member_id: aliased.operator_member_id!,
    quota_class: quotaRaw,
    codex_home: aliased.codex_home!,
    workspace: aliased.workspace!,
    executable: aliased.executable!,
    mcp_base_url: aliased.mcp_base_url!.replace(/\/$/, ""),
  };

  for (const key of ["codex_home", "workspace", "executable"] as const) {
    if (!path.isAbsolute(config[key])) {
      throw new Error(`${key} must be an absolute path`);
    }
  }
  return config;
}

export function loadSidecarConfig(configPath: string): SidecarConfig {
  return sidecarConfigFromMap(parseSidecarToml(readFileSync(configPath, "utf8")));
}

export function botTokenFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.KITH_BOT_TOKEN ?? "";
}
