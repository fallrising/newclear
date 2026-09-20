import fs from "node:fs";
import path from "node:path";
import type { SidecarConfig } from "./config.ts";

const CODEBOX_KEYS = ["CODEBOX_CODEX_HOME", "CODEBOX_WORKING_DIR", "CODEBOX_CODEX_EXECUTABLE"] as const;

export type PathCheckOk = { ok: true };
export type PathCheckFail = { ok: false; exitCode: 1; reason: string };
export type PathCheckResult = PathCheckOk | PathCheckFail;

export function canonicalPath(input: string): string {
  const abs = path.resolve(input);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    let cur = abs;
    for (;;) {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      try {
        const realParent = fs.realpathSync.native(parent);
        const rel = path.relative(parent, abs);
        return path.resolve(realParent, rel);
      } catch {
        cur = parent;
      }
    }
  }
}

function stripTrailingSep(p: string): string {
  if (p.length > 1 && (p.endsWith("/") || p.endsWith(path.sep))) {
    return p.replace(/[/\\]+$/, "");
  }
  return p;
}

export function pathsEqualOrNested(a: string, b: string): boolean {
  const na = stripTrailingSep(canonicalPath(a));
  const nb = stripTrailingSep(canonicalPath(b));
  if (na === nb) return true;
  const sep = path.sep;
  return na.startsWith(nb + sep) || nb.startsWith(na + sep);
}

export function sameInode(a: string, b: string): boolean {
  try {
    const sa = fs.statSync(canonicalPath(a));
    const sb = fs.statSync(canonicalPath(b));
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export function pairConflicts(a: string, b: string): boolean {
  return pathsEqualOrNested(a, b) || sameInode(a, b);
}

export function startupPathCheck(
  config: SidecarConfig,
  env: NodeJS.ProcessEnv = process.env,
): PathCheckResult {
  const local = [config.codex_home, config.workspace, config.executable];
  for (const key of CODEBOX_KEYS) {
    const remote = env[key];
    if (remote === undefined || remote === "") continue;
    for (const p of local) {
      if (pairConflicts(p, remote)) {
        return {
          ok: false,
          exitCode: 1,
          reason: `INV-14: ${p} intersects ${key}=${remote}`,
        };
      }
    }
  }
  return { ok: true };
}

/** INV-14: any intersecting pair exits 1. */
export function inv14ExitCode(config: SidecarConfig, env: NodeJS.ProcessEnv = process.env): number {
  return startupPathCheck(config, env).ok ? 0 : 1;
}
