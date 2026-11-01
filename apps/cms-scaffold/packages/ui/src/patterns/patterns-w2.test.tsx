import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("W2 patterns", () => {
  it("G-03 StatusBadge adds 等待發布 for an open publish request, after the state and the change badge", () => {
    const { rerender } = render(<StatusBadge state="published" dirty />);
    expect(screen.queryByTestId("status-requested")).not.toBeInTheDocument();
    rerender(<StatusBadge state="published" dirty requested />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("已發布有未發布的變更等待發布");
    rerender(<StatusBadge state="draft" requested />);
    expect(screen.getByTestId("status-badge")).toHaveTextContent("草稿等待發布");
  });
});
