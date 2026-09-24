import type { ReactElement, ReactNode } from "react";

const TONE = {
  neutral: "bg-surface-2 text-ink-2",
  accent: "bg-accent-tint text-accent-strong",
  warn: "bg-surface-2 text-warn",
  danger: "bg-surface-2 text-danger",
} as const;

export function Badge(props: { tone: keyof typeof TONE; children: ReactNode; "data-testid"?: string }): ReactElement {
  return (
    <span
      data-testid={props["data-testid"]}
      className={"inline-flex items-center rounded-full px-2 h-6 text-xs font-medium " + TONE[props.tone]}
    >
      {props.children}
    </span>
  );
}
