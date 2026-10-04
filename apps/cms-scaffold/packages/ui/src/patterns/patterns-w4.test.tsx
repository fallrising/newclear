import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox, Progress } from "../index";

describe("W4 components", () => {
  it("surface-admin §4.1 Checkbox toggles and reports; Progress exposes its value to assistive technology", () => {
    const onChange = vi.fn();
    render(
      <>
        <Checkbox aria-label="publish" onCheckedChange={onChange} />
        <Progress value={40} aria-label="usage" />
      </>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "publish" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("checkbox", { name: "publish" })).toBeChecked();
    expect(screen.getByRole("progressbar", { name: "usage" })).toHaveAttribute("aria-valuenow", "40");
  });
});
