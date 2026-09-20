import { spawn } from "node:child_process";

export type SpawnRequest = {
  executable: string;
  argv: string[];
  stdin: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  argv: string[];
  stdin: string;
};

export type SpawnFn = (req: SpawnRequest) => Promise<SpawnResult>;

/** Official CLI argv: no room body interpolation (ARGV-01). Prompt is stdin. */
export function buildCodexArgv(): string[] {
  return ["exec", "--skip-git-repo-check"];
}

export function assertArgvOmitsRoomBody(argv: string[], roomBody: string): void {
  if (!roomBody) return;
  for (const arg of argv) {
    if (arg.includes(roomBody)) {
      throw new Error("ARGV-01: room body must not appear in CLI argv");
    }
  }
}

export async function defaultSpawn(req: SpawnRequest): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(req.executable, req.argv, {
      cwd: req.cwd,
      env: req.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("codex spawn timed out"));
    }, 10_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        argv: req.argv,
        stdin: req.stdin,
      });
    });
    child.stdin?.write(req.stdin);
    child.stdin?.end();
  });
}
