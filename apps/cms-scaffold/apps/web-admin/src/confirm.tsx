import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  fill,
  Input,
  Label,
} from "@cms/ui";
import { copy } from "./copy";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** C-19 (surface-admin §8, 01 A-S4): the confirm button stays disabled until the input equals this text exactly. */
  phrase?: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Every governance write asks first. The dialog stays open while the request runs and after it fails. */
export function ConfirmDialog({ open, title, description, confirmLabel, phrase, destructive, pending, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);
  const ready = phrase === undefined || typed.trim() === phrase;
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next || pending ? undefined : onCancel())}>
      <AlertDialogContent data-testid="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {phrase !== undefined ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-phrase">{fill(copy["confirm.phraseLabel"], { phrase })}</Label>
            <Input id="confirm-phrase" autoComplete="off" value={typed} onChange={(event) => setTyped(event.target.value)} data-testid="confirm-input" />
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="confirm-cancel">
            {copy["common.cancel"]}
          </AlertDialogCancel>
          <Button type="button" variant={destructive ? "destructive" : "default"} disabled={!ready || pending} onClick={onConfirm} data-testid="confirm-submit">
            {pending ? copy["common.working"] : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** surface-admin §4.4 Principals: a temporary password is shown once; closing the dialog forgets it. */
export function TemporaryPasswordDialog({ password, title, onClose }: { password: string | null; title: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [password]);
  return (
    <AlertDialog open={password !== null}>
      <AlertDialogContent data-testid="password-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{copy["password.body"]}</AlertDialogDescription>
        </AlertDialogHeader>
        <code className="block rounded-md border bg-surface-subdued px-3 py-2 font-mono text-card-title" data-testid="temp-password">
          {password}
        </code>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(password ?? "").then(() => setCopied(true), () => setCopied(false));
            }}
            data-testid="password-copy"
          >
            {copied ? copy["password.copied"] : copy["password.copy"]}
          </Button>
          <Button type="button" onClick={onClose} data-testid="password-done">
            {copy["password.done"]}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
