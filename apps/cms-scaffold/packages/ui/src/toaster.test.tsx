import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Toaster, toast } from "./index";

describe("toast behavior across the UI export", () => {
  it("keeps Sonner styles and renders a synchronous success notification", async () => {
    render(<Toaster />);
    let id: string | number | undefined;
    act(() => { id = toast.success("保存完成"); });
    expect(id).toBeDefined();
    expect(await screen.findByText("保存完成")).toBeInTheDocument();
    expect([...document.head.querySelectorAll("style")].some((style) => style.textContent?.includes("[data-sonner-toaster]"))).toBe(true);
    act(() => { toast.dismiss(id); });
  });
});
