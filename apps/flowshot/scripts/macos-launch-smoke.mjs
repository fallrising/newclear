import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  execFile,
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";

export const acceptanceBudgetMs = 1_500;
const defaultObservationWindowMs = 15_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function releaseBinary(environment = process.env) {
  const target = resolve(repositoryRoot, environment.CARGO_TARGET_DIR || "target");
  return join(target, environment.CARGO_BUILD_TARGET || "", "release", "flowshot-tauri");
}
const windowSource = resolve(
  repositoryRoot,
  "scripts/macos-window-check.swift",
);

export function observationWindowMs(environment = process.env) {
  const raw =
    environment.MACOS_LAUNCH_OBSERVATION_MS ??
    String(defaultObservationWindowMs);
  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      "MACOS_LAUNCH_OBSERVATION_MS must be a positive integer",
    );
  }
  if (value <= acceptanceBudgetMs) {
    throw new Error(
      `MACOS_LAUNCH_OBSERVATION_MS must be greater than the ${acceptanceBudgetMs} ms acceptance budget`,
    );
  }

  return value;
}

export function assessLaunchSignals(
  { command, window },
  budgetMs = acceptanceBudgetMs,
) {
  const failures = [];

  for (const [name, signal] of Object.entries({ command, window })) {
    if ("missingReason" in signal) {
      failures.push(
        `${name} signal was not observed: ${signal.missingReason}`,
      );
    } else if (!Number.isFinite(signal.observedAtMs) || signal.observedAtMs < 0) {
      failures.push(`${name} signal has an invalid observation timestamp`);
    } else if (signal.observedAtMs >= budgetMs) {
      failures.push(
        `${name} signal arrived at ${signal.observedAtMs} ms; budget is under ${budgetMs} ms`,
      );
    }
  }

  return failures;
}

function systemFact(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}

export async function stopProcess(child, graceMs = 1_000) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolveStopped) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStopped();
    });
    child.kill("SIGTERM");
  });
}

function parseCompletionLine(line) {
  try {
    const value = JSON.parse(line);
    if (
      value.event === "command_complete" &&
      value.command === "get_build_info" &&
      value.resultCode === "OK" &&
      typeof value.correlationId === "string" &&
      value.correlationId.length > 0
    ) {
      return value;
    }
  } catch {
    // Native framework output may share stdout; only JSON command records count.
  }
  return undefined;
}

export function waitForCommand(child, output, deadline, startedAt) {
  return new Promise((resolveCommand) => {
    let buffer = "";
    let timer;

    const finish = (outcome) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      child.stdout.off("data", onData);
      resolveCommand(outcome);
    };

    const onData = (chunk) => {
      output.stdout += chunk;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const completion = parseCompletionLine(line);
        if (completion !== undefined) {
          finish({
            observedAtMs: performance.now() - startedAt,
            value: completion,
          });
          return;
        }
      }
    };

    const onExit = (code, signal) => {
      finish({
        missingReason:
          `Flowshot exited before command completion ` +
          `(code=${code}, signal=${signal})`,
      });
    };

    const onError = (error) => finish({ missingReason: `Flowshot spawn failed: ${error.message}` });
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", onData);

    const remaining = Math.max(0, deadline - performance.now());
    timer = setTimeout(() => {
      finish({
        missingReason:
          "timed out waiting for the frontend-originated get_build_info record",
      });
    }, remaining);
  });
}

export async function waitForVisibleWindow(pid, deadline, startedAt, windowProbe) {
  let lastDiagnostic = "";
  while (performance.now() < deadline) {
    const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
    const result = await new Promise((resolveProbe) => {
      execFile(windowProbe, [String(pid)], {
        encoding: "utf8", timeout: remaining, killSignal: "SIGKILL", maxBuffer: 64 * 1024,
      }, (error, stdout, stderr) => resolveProbe({ error, stdout, stderr }));
    });
    if (result.error === null) {
      try {
        const value = JSON.parse(result.stdout);
        if (value.pid !== pid || !Number.isInteger(value.windowId) || value.windowId <= 0) {
          throw new Error("probe returned a window for an invalid PID or window ID");
        }
        return { observedAtMs: performance.now() - startedAt, value };
      } catch (error) {
        lastDiagnostic = error.message;
      }
    } else {
      lastDiagnostic = result.stderr.trim() || result.error.message;
    }
    const remainingDelay = deadline - performance.now();
    if (remainingDelay > 0) {
      await delay(Math.min(remainingDelay, performance.now() - startedAt < acceptanceBudgetMs ? 20 : 100));
    }
  }
  return { missingReason: `timed out waiting for an on-screen Flowshot window: ${lastDiagnostic}` };
}

export function artifactDirectory(environment) {
  const directory = environment.FLOWSHOT_LAUNCH_ARTIFACT_DIR?.trim();
  return directory ? resolve(directory) : environment.AGENT_EVIDENCE_DIR
    ? resolve(environment.AGENT_EVIDENCE_DIR, "macos-launch") : undefined;
}

function captureScreenshot(directory, windowOutcome) {
  const screenshotPath = join(directory, "flowshot-window.png");
  const windowId =
    "value" in windowOutcome
      ? windowOutcome.value.windowId
      : undefined;
  const args =
    typeof windowId === "number"
      ? ["-x", "-l", String(windowId), screenshotPath]
      : ["-x", screenshotPath];
  const result = spawnSync("screencapture", args, {
    encoding: "utf8", timeout: 5_000,
  });

  return {
    attempted: true,
    captured: result.status === 0 && existsSync(screenshotPath),
    path: screenshotPath,
    windowId,
    diagnostic: result.stderr.trim() || undefined,
  };
}

function writeArtifacts(directory, report, output) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "launch-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  writeFileSync(join(directory, "app-stdout.log"), output.stdout, "utf8");
  writeFileSync(join(directory, "app-stderr.log"), output.stderr, "utf8");
}

async function run() {
  if (process.platform !== "darwin") {
    throw new Error("macos-launch-smoke requires macOS");
  }

  const appBinary = releaseBinary();
  if (!existsSync(appBinary)) {
    throw new Error(`release application does not exist: ${appBinary}`);
  }

  const observationMs = observationWindowMs();
  const artifacts = artifactDirectory(process.env);
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "flowshot-launch-"));
  const windowProbe = join(temporaryDirectory, "macos-window-check");

  try {
    execFileSync(
      "xcrun",
      ["swiftc", windowSource, "-o", windowProbe],
      { stdio: "inherit", timeout: 60_000 },
    );

    const output = { stdout: "", stderr: "" };
    const startedAt = performance.now();
    const deadline = startedAt + observationMs;
    const child = spawn(appBinary, [], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      output.stderr += chunk;
    });

    try {
      const [commandOutcome, windowOutcome] = await Promise.all([
        waitForCommand(child, output, deadline, startedAt),
        child.pid === undefined ? Promise.resolve({ missingReason: "Flowshot did not spawn" }) : waitForVisibleWindow(
          child.pid,
          deadline,
          startedAt,
          windowProbe,
        ),
      ]);
      const failures = assessLaunchSignals({
        command: commandOutcome,
        window: windowOutcome,
      });
      if (child.exitCode !== null || child.signalCode !== null) {
        failures.push("Flowshot exited during launch observation");
      }
      const report = {
        event: "macos_launch_smoke",
        result: failures.length === 0 ? "pass" : "fail",
        acceptanceBudgetMs,
        observationWindowMs: observationMs,
        signals: {
          command: commandOutcome,
          window: windowOutcome,
        },
        failures,
        hardware: {
          architecture: process.arch,
          cpu: systemFact("sysctl", ["-n", "machdep.cpu.brand_string"]),
          macos: systemFact("sw_vers", ["-productVersion"]),
        },
      };

      if (artifacts !== undefined) {
        mkdirSync(artifacts, { recursive: true });
        report.screenshot = captureScreenshot(
          artifacts,
          windowOutcome,
        );
        writeArtifacts(artifacts, report, output);
      }

      const serializedReport = JSON.stringify(report);
      if (failures.length > 0) {
        console.error(serializedReport);
        const diagnostic = [
          failures.join("\n"),
          output.stdout && `stdout:\n${output.stdout}`,
          output.stderr && `stderr:\n${output.stderr}`,
        ]
          .filter(Boolean)
          .join("\n");
        throw new Error(diagnostic);
      }

      console.log(serializedReport);
    } finally {
      await stopProcess(child);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await run();
}
