import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DefaultSkeleton, Skeleton, uiCopy } from "./index";

describe("lightweight hydration skeleton", () => {
  it("preserves the original Skeleton DOM, classes and loading accessibility", () => {
    render(<><DefaultSkeleton /><div data-testid="original-skeletons">
      <Skeleton className="h-6 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
    </div></>);
    const loading = screen.getByTestId("query-loading");
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading).toHaveAttribute("aria-label", uiCopy["ui.loading"]);
    expect(loading).toHaveClass("flex", "flex-col", "gap-3");
    expect(loading.innerHTML).toBe(screen.getByTestId("original-skeletons").innerHTML);
  });
});
