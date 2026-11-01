import type { AiStatus } from "./ai_ipc";

/** A visible setup problem also blocks toolbar and keyboard submission. */
export function aiSetupProblem(status: AiStatus | null): string | null {
  if (!status) return "AI settings are unavailable. Relaunch Loom to retry.";
  if (status.configuration_error) return status.configuration_error;
  if (!status.key_present) return `${status.key_env} is not set. Add it to Loom's launch environment, then relaunch.`;
  return null;
}
