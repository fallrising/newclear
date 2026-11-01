import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildReading } from "../../reading/build.ts";
import { WEB_DIST_DIR } from "./paths.ts";

export const ARTICLE_A = "rc-article-a";
export const ARTICLE_B = "rc-article-b";
export const BUNDLE_PATH = join(process.env.E2E_WEB === "dev" ? join(process.env.KITH_E2E_RUN_DIR!, "state", "empty-assets") : WEB_DIST_DIR, "_reading", "current.json");

export function git(repo: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", repo, ...args], {
    encoding: "utf8", timeout: 30_000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) throw new Error(`synthetic git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
export function identity(repo: string): void {
  git(repo, "config", "user.name", "Kith synthetic acceptance");
  git(repo, "config", "user.email", "kith@example.invalid");
}
export function contentRepo(): string {
  const dir = process.env.KITH_E2E_RUN_DIR;
  if (!dir) throw new Error("isolated E2E run required");
  return join(dir, "state", "reading-content");
}
export function commitContent(repo: string, title: string): string {
  git(repo, "add", "--all");
  git(repo, "commit", "--allow-empty", "-m", title);
  return git(repo, "rev-parse", "HEAD");
}
export function writeRegistry(repo: string, pathA = "a.md"): void {
  writeFileSync(join(repo, "articles.json"), JSON.stringify({ version: 1, articles: [
    { id: ARTICLE_A, title: "Synthetic article A", path: pathA },
    { id: ARTICLE_B, title: "Synthetic article B", path: "b.md" },
  ] }));
}
export async function publishContent(commit: string): Promise<void> {
  await buildReading({ repo: contentRepo(), commit, registry: "articles.json", output: BUNDLE_PATH });
}
export async function seedReadingFixture(): Promise<void> {
  const repo = contentRepo();
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--initial-branch=main");
  identity(repo);
  writeRegistry(repo);
  writeFileSync(join(repo, "a.md"), `# Synthetic A initial\n\nAI body version one.\n\n- [B](/reading/${ARTICLE_B})\n\n<script>window.readingUnsafe = true</script>\n\n[unsafe](javascript:alert(1))\n`);
  writeFileSync(join(repo, "b.md"), "# Synthetic B initial\n\nB body remains stable.\n");
  await publishContent(commitContent(repo, "synthetic reading baseline"));
}
export function exportRepo(label: string): { repo: string; remote: string; rival: string } {
  const root = join(process.env.KITH_E2E_RUN_DIR!, "state", label);
  mkdirSync(root, { recursive: true });
  const remote = join(root, "remote.git");
  const repo = join(root, "runner");
  const rival = join(root, "rival");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, repo);
  identity(repo);
  writeFileSync(join(repo, "README.md"), "Synthetic exporter fixture.\n");
  commitContent(repo, "initial synthetic content");
  git(repo, "push", "-u", "origin", "main");
  git(root, "clone", remote, rival);
  identity(rival);
  return { repo, remote, rival };
}
