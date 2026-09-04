import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import type { AppErrorDto, BuildInfoDto } from "./generated/contracts";

afterEach(cleanup);

const BUILD_INFO: BuildInfoDto = {
  version: "0.1.0",
  gitSha: "abc123",
  buildProfile: "test",
};

describe("build information", () => {
  it("shows a loading state while the typed command is pending", () => {
    render(<App loadBuildInfo={() => new Promise(() => undefined)} />);

    expect(screen.getByText("Loading build information…")).toBeTruthy();
  });

  it("renders the typed command response", async () => {
    render(<App loadBuildInfo={async () => BUILD_INFO} />);

    expect(
      await screen.findByRole("heading", { name: "Foundation ready" }),
    ).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("abc123")).toBeTruthy();
    expect(screen.getByText("test")).toBeTruthy();
  });

  it("renders a safe typed command error", async () => {
    const error: AppErrorDto = {
      code: "INTERNAL",
      message: "Build metadata is unavailable.",
      retryable: false,
      correlationId: "corr-test",
    };

    render(
      <App
        loadBuildInfo={() => Promise.reject(error)}
      />,
    );

    expect(
      await screen.findByRole("heading", {
        name: "Build information unavailable",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Build metadata is unavailable.",
    );
  });
});
