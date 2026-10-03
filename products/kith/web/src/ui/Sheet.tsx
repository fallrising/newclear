import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";

export function Sheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: "right" | "bottom";
  title: string;
  "data-testid"?: string;
  children: ReactNode;
}): ReactElement {
  const content =
    props.side === "right"
      ? "fixed inset-y-0 right-0 flex w-80 max-w-full flex-col bg-surface shadow-popover"
      : "fixed inset-x-0 bottom-0 flex h-sheet flex-col rounded-t-lg bg-surface pb-safe shadow-popover";
  return (
    <RadixDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <RadixDialog.Content data-testid={props["data-testid"]} aria-describedby={undefined} className={content}>
          <RadixDialog.Title className="sr-only">{props.title}</RadixDialog.Title>
          {props.children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
