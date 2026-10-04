import type { ReactNode } from "react";
import type { FieldErrors, Resolver, UseFormReturn } from "react-hook-form";
import { isApiError, type WorkContentType, type WorkEntry } from "@cms/api";
import { serverFieldErrors, toFormValues, zodFormResolver, type FormValues } from "@cms/fields";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@cms/ui";
import { copy } from "../copy";

// Form helpers and small building blocks of the Resource details page (resource-details.tsx).
/**
 * The slug lives in the same form under "$slug". react-hook-form treats "." in a name as a path, so field keys must
 * be identifiers; the contract does not enforce that yet (01 Q-12, W1-FM12).
 */
export const SLUG = "$slug";

type SlugError = "REQUIRED" | "SLUG_CONFLICT" | "CANNOT_CLEAR";

export function formOf(type: WorkContentType, entry: WorkEntry | null): FormValues {
  return { ...toFormValues(type, entry?.payload ?? {}), [SLUG]: entry?.slug ?? "" };
}

/** zod (save rules) for the fields plus the one slug rule the client can know: an existing slug cannot be cleared. */
export function saveResolver(type: WorkContentType, entry: WorkEntry | null): Resolver<FormValues> {
  const fields = zodFormResolver(type, "save");
  return async (values, context, options) => {
    const result = await fields(values, context, options);
    const slug = String(values[SLUG] ?? "").trim();
    if (!entry?.slug || slug !== "") return result;
    const errors: FieldErrors<FormValues> = { ...(result.errors as FieldErrors<FormValues>) };
    errors[SLUG] = { type: "validate", message: "CANNOT_CLEAR" };
    return { values: {}, errors };
  };
}

export function slugMessage(code: string | undefined): string | null {
  if (!code) return null;
  return copy[`slug.error.${code as SlugError}`] ?? copy["details.failed"];
}

/** Puts every 422 `error.fields` entry (and SLUG_REQUIRED) on its control. Returns true when something was placed. */
export function placeServerErrors(form: UseFormReturn<FormValues>, type: WorkContentType, error: unknown): boolean {
  if (!isApiError(error) || error.status !== 422) return false;
  if (error.code === "SLUG_REQUIRED") {
    form.setError(SLUG, { type: "server", message: "REQUIRED" });
    return true;
  }
  const placed = serverFieldErrors(type, error.fields ?? []);
  for (const { key, code } of placed) form.setError(key, { type: "server", message: code });
  return placed.length > 0;
}

interface ConfirmProps {
  open: boolean;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
  testId: string;
}

/** 01 §7.2: 封存 and 移到回收 always ask first (C-06). */
export function Confirm({ open, title, body, action, onConfirm, onCancel, testId }: ConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <AlertDialogContent data-testid={testId}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{copy["details.cancel"]}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} data-testid={`${testId}-confirm`}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SideCard({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}
