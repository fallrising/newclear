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
  Checkbox,
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
  confirmationWord?: "DELETE";
  acknowledgementLabel?: string;
  destructive?: boolean;
  pending: boolean;
  onConfirm: (typed: string, word?: string) => void;
  onCancel: () => void;
}

/** Every governance write asks first. The parent closes the dialog on completion; retry requires reopening it. */
export function ConfirmDialog({ open, title, description, confirmLabel, phrase, confirmationWord, acknowledgementLabel, destructive, pending, onConfirm, onCancel }: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [word, setWord] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (!open) {
      setTyped("");
      setWord("");
      setAcknowledged(false);
    }
  }, [open]);
  const ready = confirmationWord === undefined
    ? phrase === undefined || typed.trim() === phrase
    : typed === phrase && word === confirmationWord && acknowledgementLabel !== undefined && acknowledged;
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
            <Input id="confirm-phrase" autoComplete="off" disabled={pending} value={typed} onChange={(event) => setTyped(event.target.value)} data-testid="confirm-input" />
          </div>
        ) : null}
        {confirmationWord !== undefined ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-word">{copy["confirm.deletionWordLabel"]}</Label>
            <Input id="confirm-word" autoComplete="off" disabled={pending} value={word} onChange={(event) => setWord(event.target.value)} data-testid="confirm-word" />
          </div>
        ) : null}
        {acknowledgementLabel !== undefined ? (
          <Label htmlFor="confirm-acknowledgement" className="flex items-center gap-2">
            <Checkbox
              id="confirm-acknowledgement"
              checked={acknowledged}
              disabled={pending}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
              data-testid="confirm-acknowledgement"
            />
            {acknowledgementLabel}
          </Label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} data-testid="confirm-cancel">
            {copy["common.cancel"]}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={!ready || pending}
            onClick={() => onConfirm(confirmationWord === undefined ? typed.trim() : typed, word)}
            data-testid="confirm-submit"
          >
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
