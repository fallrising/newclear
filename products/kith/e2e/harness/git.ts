import { execFileSync } from "node:child_process";
import { KITH_DIR } from "./paths.ts";

export type GitInfo = { sha: string; short: string; dirty: boolean; branch: string };

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: KITH_DIR, encoding: "utf8" }).trim();
}

export function readGit(): GitInfo {
  try {
    const sha = git(["rev-parse", "HEAD"]);
    const short = git(["rev-parse", "--short=7", "HEAD"]);
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    const dirty = git(["status", "--porcelain"]) !== "";
    return { sha, short, dirty, branch };
  } catch (e) {
    throw new Error("kith e2e requires a git checkout: " + (e instanceof Error ? e.message : String(e)));
  }
}
