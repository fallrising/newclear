import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./confirm";

function PurgeDialog({ pending = false, onConfirm = vi.fn(), onCancel = vi.fn() }: {
  pending?: boolean;
  onConfirm?: (typed: string, word?: string) => void;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>Reopen</button>
      <ConfirmDialog
        open={open}
        title="永久刪除？"
        description="無法復原。"
        confirmLabel="永久刪除"
        phrase="coast-harbour"
        confirmationWord="DELETE"
        acknowledgementLabel="我了解永久刪除後無法復原。"
        destructive
        pending={pending}
        onConfirm={onConfirm}
        onCancel={() => { onCancel(); setOpen(false); }}
      />
    </>
  );
}

describe("PP1-FM07 permanent-delete confirmation", () => {
  it("requires exact raw target, DELETE word and acknowledgement before callback", () => {
    const onConfirm = vi.fn();
    render(<PurgeDialog onConfirm={onConfirm} />);
    const dialog = screen.getByTestId("confirm-dialog");
    const submit = within(dialog).getByTestId("confirm-submit");
    const target = within(dialog).getByTestId("confirm-input");
    const word = within(dialog).getByTestId("confirm-word");
    const acknowledgement = within(dialog).getByTestId("confirm-acknowledgement");

    expect(submit).toBeDisabled();
    fireEvent.change(target, { target: { value: "coast-harbour" } });
    fireEvent.change(word, { target: { value: "DELETE" } });
    expect(submit).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(acknowledgement);
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("coast-harbour", "DELETE");
  });

  it.each([
    ["target leading space", " coast-harbour", "DELETE"],
    ["target trailing space", "coast-harbour ", "DELETE"],
    ["word lowercase", "coast-harbour", "delete"],
    ["word trailing space", "coast-harbour", "DELETE "],
    ["empty target", "", "DELETE"],
    ["empty word", "coast-harbour", ""],
  ])("does not submit invalid raw values: %s", (_name, targetValue, wordValue) => {
    const onConfirm = vi.fn();
    render(<PurgeDialog onConfirm={onConfirm} />);
    const dialog = screen.getByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: targetValue } });
    fireEvent.change(within(dialog).getByTestId("confirm-word"), { target: { value: wordValue } });
    fireEvent.click(within(dialog).getByTestId("confirm-acknowledgement"));
    const submit = within(dialog).getByTestId("confirm-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables every control while pending", () => {
    render(<PurgeDialog pending />);
    const dialog = screen.getByTestId("confirm-dialog");
    expect(within(dialog).getByTestId("confirm-input")).toBeDisabled();
    expect(within(dialog).getByTestId("confirm-word")).toBeDisabled();
    expect(within(dialog).getByTestId("confirm-acknowledgement")).toBeDisabled();
    expect(within(dialog).getByTestId("confirm-cancel")).toBeDisabled();
    expect(within(dialog).getByTestId("confirm-submit")).toBeDisabled();
  });

  it("forgets all three values after closing and manually reopening", async () => {
    const onCancel = vi.fn();
    render(<PurgeDialog onCancel={onCancel} />);
    let dialog = screen.getByTestId("confirm-dialog");
    fireEvent.change(within(dialog).getByTestId("confirm-input"), { target: { value: "coast-harbour" } });
    fireEvent.change(within(dialog).getByTestId("confirm-word"), { target: { value: "DELETE" } });
    fireEvent.click(within(dialog).getByTestId("confirm-acknowledgement"));
    fireEvent.click(within(dialog).getByTestId("confirm-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("reopen"));
    dialog = await screen.findByTestId("confirm-dialog");
    expect(within(dialog).getByTestId("confirm-input")).toHaveValue("");
    expect(within(dialog).getByTestId("confirm-word")).toHaveValue("");
    expect(within(dialog).getByTestId("confirm-acknowledgement")).not.toBeChecked();
    expect(within(dialog).getByTestId("confirm-submit")).toBeDisabled();
  });
});
