import * as RadixDialog from "@radix-ui/react-dialog";
import type { ReactElement, ReactNode } from "react";

export function Dialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  "data-testid"?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <RadixDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
        <div className="fixed inset-0 flex items-center justify-center px-4">
          <RadixDialog.Content
            data-testid={props["data-testid"]}
            aria-describedby={props.description ? "dialog-desc" : undefined}
            className="relative flex w-full max-w-login flex-col gap-4 rounded-lg bg-surface p-6 shadow-popover focus-visible:outline-none"
          >
            <RadixDialog.Title className="text-lg font-semibold text-ink">{props.title}</RadixDialog.Title>
            {props.description && (
              <RadixDialog.Description id="dialog-desc" className="text-sm text-ink-2">
                {props.description}
              </RadixDialog.Description>
            )}
            {props.children}
          </RadixDialog.Content>
        </div>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
