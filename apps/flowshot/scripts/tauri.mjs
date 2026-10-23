import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { projectRoot, tauriArguments, tauriEnvironment } from "./build-paths.mjs";

const child = spawn(process.execPath, [resolve(projectRoot, "node_modules/@tauri-apps/cli/tauri.js"), ...tauriArguments(process.argv.slice(2))], { stdio: "inherit", cwd: projectRoot, env: tauriEnvironment() });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
