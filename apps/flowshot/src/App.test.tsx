import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the accessible Flowshot foundation shell", () => {
    render(<App loadBuildInfo={() => new Promise(() => undefined)} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Flowshot" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Connecting to the desktop core",
      }),
    ).toBeTruthy();
  });
});
