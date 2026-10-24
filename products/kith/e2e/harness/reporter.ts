import { copyFileSync, existsSync, realpathSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { E2E_DIR } from "./paths.ts";
import { readObservedSecrets, redactText, RULE_IDS, scanText } from "./redact.ts";
import { sha256File, validateRunDir } from "./validate.ts";

// Writes manifest.json and summary.md for one run (docs/v2/milestones/W0.md §5.1.10).

type Evidence = { kind: string; path?: string; text?: string; sha256?: string };
type Result = {
  id: string;
  spec: string;
  title: string;
  project: string;
  tags: string[];
  status: string;
  duration_ms: number;
  retry: number;
  evidence: Evidence[];
};
type RunContext = {
  run_id: string;
  git: { sha: string; short: string; dirty: boolean; branch: string };
  scope: string;
  web_mode: string;
  base_url: string;
  versions: { node: string; wrangler: string; playwright: string; chromium: string };
  seed: { id: string; sha256: string };
  started_at: string;
};

const ID_RE = /^((?:E2E|PROBE)-W[0-7]-[0-9]{2}|E2E-RC-0[1-7]|E2E-PT-01|E2E-VIS-0[1-3]) /;
const FILES_EXCLUDED_DIRS = ["report", "test-output", "state", "nested"];
const SCAN_EXCLUDED_DIRS = ["report", "test-output", "traces", "state", "nested"];
const SCAN_EXTENSIONS = [".jsonl", ".json", ".log", ".md", ".txt"];

function listFiles(root: string, excludedDirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs);
      if (statSync(abs).isDirectory()) {
        if (!(dir === root && excludedDirs.includes(name))) walk(abs);
      } else if (rel !== "manifest.json" && rel !== "summary.md") {
        out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

export default class KithReporter implements Reporter {
  private startedAt = new Date().toISOString();
  private readonly results: Result[] = [];
  private readonly errors: string[] = [];
  private readonly globalErrors: string[] = [];

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, _suite: Suite): void {
    this.startedAt = new Date().toISOString();
  }

  onError(error: TestError): void {
    this.globalErrors.push(redactText(error.message ?? String(error.value ?? "error")).slice(0, 500));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = ID_RE.exec(test.title)?.[1];
    if (!id) {
      this.errors.push("missing acceptance id: " + test.title);
      return;
    }
    const project = test.parent.project()?.name ?? "desktop";
    const evidence: Evidence[] = test.annotations
      .filter((a) => a.type === "evidence" && a.description !== undefined)
      .map((a) => JSON.parse(a.description!) as Evidence);
    const runDir = process.env.KITH_E2E_RUN_DIR!;
    const visualRoles = new Map<string, string[]>();
    for (const att of result.attachments) {
      // Playwright's native comparison attaches these three roles on pixel mismatch.
      // Actual/diff come from this run output; expected may be one approved baseline.
      const visual = /^([a-z0-9-]+)-(expected|actual|diff)\.png$/.exec(att.name);
      if (id.startsWith("E2E-VIS-") && visual) {
        const roles = visualRoles.get(visual[1]!) ?? [];
        roles.push(visual[2]!);
        visualRoles.set(visual[1]!, roles);
        const output = join(runDir, "test-output");
        const rel = att.path && existsSync(att.path) ? relative(output, realpathSync(att.path)) : "..";
        const baseline = process.env.KITH_VISUAL_BASELINE_DIR ?? join(E2E_DIR, "visual-baselines");
        const expected = join(baseline, visual[1]! + ".png");
        const fromBaseline = visual[2] === "expected" && ["login", "home-empty", "people-list"].includes(visual[1]!) &&
          att.path && existsSync(att.path) && existsSync(expected) && realpathSync(att.path) === realpathSync(expected);
        if (!att.path || att.contentType !== "image/png" || (!fromBaseline && (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))) ||
          !existsSync(att.path) || statSync(att.path).size > 10 * 1024 * 1024 ||
          !readFileSync(att.path).subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
          this.errors.push("invalid visual attachment: " + att.name);
          continue;
        }
        const path = "files/" + id + "/" + project + "-" + basename(att.name);
        mkdirSync(join(runDir, "files", id), { recursive: true });
        copyFileSync(att.path, join(runDir, path));
        evidence.push({ kind: "visual-" + visual[2]!, path });
      }
      if (att.name === "trace" && att.path && existsSync(att.path)) {
        const rel = "traces/" + id + "." + project + ".zip";
        mkdirSync(join(runDir, "traces"), { recursive: true });
        copyFileSync(att.path, join(runDir, rel));
        evidence.push({ kind: "trace", path: rel });
      }
    }
    for (const [scene, roles] of visualRoles) {
      // Candidate creation passes with expected/actual only. A failed comparison or diff
      // must preserve exactly one complete same-scene triplet for forensic validation.
      if ((result.status !== "passed" || roles.includes("diff")) &&
        [...roles].sort().join(",") !== "actual,diff,expected") {
        this.errors.push("incomplete visual comparison bundle: " + id + "/" + scene);
      }
    }
    this.results.push({
      id,
      spec: relative(E2E_DIR, test.location.file),
      title: test.title,
      project,
      tags: test.tags,
      status: result.status,
      duration_ms: Math.round(result.duration),
      retry: result.retry,
      evidence,
    });
  }

  async onEnd(result: FullResult): Promise<{ status?: FullResult["status"] }> {
    const runDir = process.env.KITH_E2E_RUN_DIR!;
    const runId = process.env.KITH_E2E_RUN_ID!;
    const secretFile = process.env.KITH_E2E_SECRET_FILE;
    if (process.env.KITH_E2E_RUN_DIR_OWNED !== "1") {
      console.log("[kith-e2e] run dir not owned by this run; nothing written");
      return { status: "failed" };
    }
    if (process.env.KITH_E2E_SETUP_OK !== "1") {
      const lines = this.globalErrors.map((e) => "- " + e.replace(/\n/g, " ")).join("\n");
      writeFileSync(join(runDir, "summary.md"), `# E2E run ${runId}\n\n- 狀態：setup failed\n${lines ? "\n" + lines + "\n" : ""}`);
      if (secretFile) rmSync(secretFile, { force: true });
      return { status: "failed" };
    }

    const ctx = JSON.parse(readFileSync(join(runDir, "run-context.json"), "utf8")) as RunContext;
    const errors = [...this.errors];

    for (const r of this.results) {
      r.evidence = r.evidence.filter((e) => {
        if (e.path === undefined) return true;
        if (existsSync(join(runDir, e.path))) return true;
        errors.push("missing evidence file: " + e.path);
        return false;
      });
      for (const e of r.evidence) if (e.path !== undefined) e.sha256 = sha256File(join(runDir, e.path));
    }

    const observed = readObservedSecrets();
    const scanned = listFiles(runDir, SCAN_EXCLUDED_DIRS).filter((p) => SCAN_EXTENSIONS.some((ext) => p.endsWith(ext)));
    const hits: { file: string; rule: string }[] = [];
    for (const file of scanned) {
      for (const rule of scanText(readFileSync(join(runDir, file), "utf8"), observed)) hits.push({ file, rule });
    }

    const files = listFiles(runDir, FILES_EXCLUDED_DIRS).map((path) => ({
      path,
      sha256: sha256File(join(runDir, path)),
      bytes: statSync(join(runDir, path)).size,
    }));

    let status: FullResult["status"] = result.status;
    if (errors.length > 0 || hits.length > 0) status = "failed";

    const manifest = {
      schema: "kith-e2e-manifest/v1",
      run_id: runId,
      git: ctx.git,
      command: "playwright " + process.argv.slice(2).join(" "),
      scope: ctx.scope,
      web_mode: ctx.web_mode,
      base_url: ctx.base_url,
      versions: ctx.versions,
      seed: ctx.seed,
      started_at: ctx.started_at,
      finished_at: new Date().toISOString(),
      status,
      results: this.results,
      files,
      redaction: { patterns: [...RULE_IDS], scanned_files: scanned.length, hits_after_redaction: hits.length, hits },
      errors,
    };
    const write = (): void => {
      writeFileSync(join(runDir, "summary.md"), summary(manifest, ctx));
      writeFileSync(join(runDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    };
    write();

    const v = validateRunDir(runDir);
    if (!v.ok) {
      for (const p of v.problems) console.log("[kith-e2e] " + p);
      manifest.status = status = "failed";
      manifest.errors.push(...v.problems.map((p) => p.slice(0, 500)));
      write();
    }

    if (secretFile) rmSync(secretFile, { force: true });
    console.log(`[kith-e2e] run ${runId}: ${status}; evidence at ${runDir}`);
    return { status };
  }
}

type ManifestForSummary = {
  run_id: string;
  status: string;
  command: string;
  results: Result[];
  files: { path: string; sha256: string; bytes: number }[];
  redaction: { scanned_files: number; hits_after_redaction: number; hits: { file: string; rule: string }[] };
  errors: string[];
};

function summary(m: ManifestForSummary, ctx: RunContext): string {
  const out: string[] = [
    `# E2E run ${m.run_id}`,
    "",
    `- 狀態：${m.status}`,
    `- 指令：\`${m.command}\``,
    `- 範圍：${ctx.scope} · web：${ctx.web_mode} · base_url：${ctx.base_url}`,
    `- git：${ctx.git.short}（${ctx.git.branch}，dirty=${ctx.git.dirty}）`,
    `- 種子：${ctx.seed.id}（sha256 ${ctx.seed.sha256.slice(0, 12)}）`,
    `- 版本：node ${ctx.versions.node} · wrangler ${ctx.versions.wrangler} · playwright ${ctx.versions.playwright} · chromium ${ctx.versions.chromium}`,
    `- 遮罩：掃描 ${m.redaction.scanned_files} 個檔案，命中 ${m.redaction.hits_after_redaction}`,
    "",
    "| ID | 專案 | 狀態 | 耗時 | 證據 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of m.results) {
    const links = r.evidence
      .filter((e) => e.path !== undefined)
      .map((e) => `[${e.path!.split("/").pop()}](${e.path})`)
      .join(" · ");
    out.push(`| ${r.id} | ${r.project} | ${r.status} | ${(r.duration_ms / 1000).toFixed(1)} s | ${links} |`);
  }
  out.push("", "## 斷言", "");
  const assertions = m.results.flatMap((r) =>
    r.evidence.filter((e) => e.kind === "assertion").map((e) => `- ${r.id}（${r.project}）：${e.text}`),
  );
  out.push(...(assertions.length > 0 ? assertions : ["- 無"]));
  out.push("", "## 錯誤", "");
  out.push(...(m.errors.length > 0 ? m.errors.map((e) => "- " + e) : ["- 無"]));
  out.push("", "## 遮罩命中", "");
  out.push(...(m.redaction.hits.length > 0 ? m.redaction.hits.map((h) => `- ${h.file}：${h.rule}`) : ["- 無"]));
  out.push("", "## 檔案雜湊", "", "| 檔案 | sha256 | bytes |", "| --- | --- | --- |");
  for (const f of m.files) out.push(`| ${f.path} | ${f.sha256} | ${f.bytes} |`);
  return out.join("\n") + "\n";
}
