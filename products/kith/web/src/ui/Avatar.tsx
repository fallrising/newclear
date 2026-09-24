import type { ReactElement } from "react";
import { avatarIndex, initials } from "./avatar";

// Full class strings so Tailwind can see them.
const COLORS = [
  "bg-avatar-0", "bg-avatar-1", "bg-avatar-2", "bg-avatar-3",
  "bg-avatar-4", "bg-avatar-5", "bg-avatar-6", "bg-avatar-7",
] as const;

const SIZES = {
  24: "h-6 w-6 text-xs",
  28: "h-7 w-7 text-xs",
  36: "h-9 w-9 text-sm",
  40: "h-10 w-10 text-md",
} as const;

export function Avatar(props: { id: string; name: string; kind: "human" | "agent"; size: 24 | 28 | 36 | 40 }): ReactElement {
  const shape = props.kind === "agent" ? "rounded-avatar-agent" : "rounded-full";
  const className = [
    "inline-flex shrink-0 items-center justify-center font-medium text-on-avatar",
    SIZES[props.size],
    shape,
    COLORS[avatarIndex(props.id)],
  ].join(" ");
  return (
    <span aria-hidden="true" className={className}>
      {initials(props.name)}
    </span>
  );
}
