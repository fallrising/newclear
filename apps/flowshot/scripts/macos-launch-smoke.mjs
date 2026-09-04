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
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";

export const acceptanceBudgetMs = 1_500;
const defaultObservationWindowMs = 15_000;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appBinary = resolve(repositoryRoot, "target/release/flowshot-tauri");
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

function stopProcess(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
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

function waitForCommand(child, output, deadline, startedAt) {
  return new Promise((resolveCommand) => {
    let buffer = "";
    let timer;

    const finish = (outcome) => {
      clearTimeout(timer);
      child.off("exit", onExit);
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
            observedAtMs: Math.round(performance.now() - startedAt),
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

async function waitForVisibleWindow(
  pid,
  deadline,
  startedAt,
  windowProbe,
) {
  let lastDiagnostic = "";

  while (performance.now() < deadline) {
    const result = spawnSync(windowProbe, [String(pid)], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return {
        observedAtMs: Math.round(performance.now() - startedAt),
        value: JSON.parse(result.stdout),
      };
    }
    lastDiagnostic = result.stderr.trim();
    const elapsedMs = performance.now() - startedAt;
    await delay(elapsedMs < acceptanceBudgetMs ? 20 : 100);
  }

  return {
    missingReason:
      `timed out waiting for an on-screen Flowshot window: ` +
      lastDiagnostic,
  };
}

function artifactDirectory(environment) {
  const directory = environment.FLOWSHOT_LAUNCH_ARTIFACT_DIR?.trim();
  return directory ? resolve(directory) : undefined;
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
    encoding: "utf8",
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
      { stdio: "inherit" },
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
        waitForVisibleWindow(
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
      stopProcess(child);
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  await run();
}
