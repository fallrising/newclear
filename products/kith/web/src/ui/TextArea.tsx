import type { ReactElement } from "react";
import { useT } from "../copy";

type TextAreaProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  maxBytes?: number;
  "data-testid"?: string;
  describedBy?: string;
  invalid?: boolean;
};

const CONTROL =
  "px-3 rounded-md border border-border-strong bg-surface text-ink text-md-touch md:text-md " +
  "py-2 font-mono text-sm " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "aria-invalid:border-danger disabled:opacity-50";

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function TextArea(props: TextAreaProps): ReactElement {
  const t = useT();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="text-sm font-medium text-ink-2">
        {props.label}
      </label>
      <textarea
        id={props.id}
        rows={props.rows}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        data-testid={props["data-testid"]}
        className={CONTROL}
      />
      {props.maxBytes !== undefined ? (
        <p className="text-xs text-ink-3">{t("form.bytes", { n: utf8Bytes(props.value), max: props.maxBytes })}</p>
      ) : null}
    </div>
  );
}
