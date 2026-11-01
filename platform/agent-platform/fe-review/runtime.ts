import { spawn, type ChildProcess } from "node:child_process";

export function assertSafeDatabase(url: string) {
  const parsed = new URL(url);
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/agent_platform_test" ||
    !parsed.password
  ) {
    throw new Error("dedicated_loopback_test_database_required");
  }
}

export function publicText(value: unknown, secrets: string[]) {
  const text = JSON.stringify(value);
  if (
    secrets.some((secret) => secret.length > 3 && text.includes(secret)) ||
    /postgres(?:ql)?:\/\/|csrf_token|session_cookie|\/home\//i.test(text)
  ) {
    throw new Error("private_material_in_public_artifact");
  }
  return text;
}

export async function cleanupAll(actions: Array<() => Promise<void>>) {
  const failures: string[] = [];
  for (const [index, action] of actions.entries()) {
    try {
      await action();
    } catch {
      failures.push(`cleanup_${index}_failed`);
    }
  }
  return failures;
}

export class OwnedProcess {
  readonly child: ChildProcess;
  readonly finished: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>;
  log = "";
  constructor(
    python: string,
    action: "serve" | "produce" | "counts",
    cwd: string,
  ) {
    const database = process.env.TEST_DATABASE_URL ?? "";
    assertSafeDatabase(database);
    this.child = spawn(python, ["scripts/browser-fixture.py", action], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        PYTHONUNBUFFERED: "1",
        TEST_DATABASE_URL: database,
      },
    });
    this.child.stdout!.on("data", (data: Buffer) => {
      this.log = (this.log + data.toString()).slice(-100000);
    });
    this.child.stderr!.on("data", (data: Buffer) => {
      this.log = (this.log + data.toString()).slice(-100000);
    });
    this.finished = new Promise((resolve, reject) => {
      this.child.once("error", reject);
      this.child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    // A spawn error is still observed by wait/stop; never leave an unhandled rejection.
    void this.finished.catch(() => {});
  }
  async wait(timeout = 30000) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.finished,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("owned_process_deadline")),
            timeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async stop() {
    if (this.child.exitCode === null && this.child.signalCode === null)
      this.child.kill("SIGTERM");
    try {
      return await this.wait(10000);
    } catch {
      this.child.kill("SIGKILL");
      await this.wait(5000);
      throw new Error("owned_process_required_sigkill");
    }
  }
}

export function confirmedFixtureShutdown(
  result: { code: number | null; signal: NodeJS.Signals | null },
  log: string,
) {
  return (
    ((result.code === 0 && result.signal === null) ||
      (result.code === null && result.signal === "SIGTERM")) &&
    log.includes("Application shutdown complete.") &&
    log.includes("Finished server process")
  );
}
