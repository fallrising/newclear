import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BuildInfoDto } from "./generated/contracts";

const { getBuildInfo } = vi.hoisted(() => ({
  getBuildInfo: vi.fn(),
}));

vi.mock("./generated/contracts", () => ({ getBuildInfo }));

const BUILD_INFO: BuildInfoDto = {
  version: "0.1.0",
  gitSha: "launch-test",
  buildProfile: "test",
};

beforeEach(() => {
  vi.resetModules();
  getBuildInfo.mockReset();
  delete window.__FLOWSHOT_BUILD_INFO_PROMISE__;
});

describe("launch build information", () => {
  it("starts the desktop command as soon as the launch module loads", async () => {
    const response = Promise.resolve(BUILD_INFO);
    getBuildInfo.mockReturnValue(response);

    const { loadBuildInfoAtLaunch } = await import("./launch-build-info");

    expect(getBuildInfo).toHaveBeenCalledOnce();
    expect(loadBuildInfoAtLaunch()).toBe(response);
    await expect(loadBuildInfoAtLaunch()).resolves.toEqual(BUILD_INFO);
  });

  it("reuses the document-start command when Tauri injected it", async () => {
    const response = Promise.resolve(BUILD_INFO);
    window.__FLOWSHOT_BUILD_INFO_PROMISE__ = response;

    const { loadBuildInfoAtLaunch } = await import("./launch-build-info");

    expect(getBuildInfo).not.toHaveBeenCalled();
    expect(loadBuildInfoAtLaunch()).toBe(response);
    await expect(loadBuildInfoAtLaunch()).resolves.toEqual(BUILD_INFO);
  });
});
