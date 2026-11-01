import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function distributionDirectory(environment = process.env) {
  return environment.AGENT_BUILD_DIR
    ? resolve(environment.AGENT_BUILD_DIR, "dist")
    : resolve(projectRoot, "dist");
}
export function tauriArguments(args, environment = process.env) {
  if (!environment.AGENT_BUILD_DIR || !["build", "dev"].includes(args[0])) return args;
  return [...args, "--config", JSON.stringify({ build: { frontendDist: distributionDirectory(environment) } })];
}

export function tauriEnvironment(environment = process.env) {
  const result = { ...environment };
  if (result.CARGO_TARGET_DIR) result.CARGO_TARGET_DIR = resolve(projectRoot, result.CARGO_TARGET_DIR);
  return result;
}
