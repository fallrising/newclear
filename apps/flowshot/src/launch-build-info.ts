import {
  getBuildInfo,
  type BuildInfoDto,
} from "./generated/contracts";

declare global {
  interface Window {
    __FLOWSHOT_BUILD_INFO_PROMISE__?: Promise<BuildInfoDto>;
  }
}

const buildInfoAtLaunch =
  window.__FLOWSHOT_BUILD_INFO_PROMISE__ ?? getBuildInfo();

// The UI attaches its own error state during React startup. Mark the eager
// promise handled immediately so a fast IPC rejection is not reported as an
// unhandled rejection before React imports finish.
void buildInfoAtLaunch.catch(() => undefined);

export function loadBuildInfoAtLaunch() {
  return buildInfoAtLaunch;
}
