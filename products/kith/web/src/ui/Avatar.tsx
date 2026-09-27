import type { ReactElement } from "react";
import { Plug, Sparkles, Terminal } from "lucide-react";
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

const RUNTIME_ICON = {
  hosted: Sparkles,
  runner: Terminal,
  external: Plug,
} as const;

export function Avatar(props: {
  id: string;
  name: string;
  kind: "human" | "agent";
  size: 24 | 28 | 36 | 40;
  runtime?: "hosted" | "runner" | "external" | null;
}): ReactElement {
  const shape = props.kind === "agent" ? "rounded-avatar-agent" : "rounded-full";
  const className = [
    "inline-flex shrink-0 items-center justify-center font-medium text-on-avatar",
    SIZES[props.size],
    shape,
    COLORS[avatarIndex(props.id)],
  ].join(" ");
  const face = (
    <span aria-hidden="true" className={className}>
      {initials(props.name)}
    </span>
  );
  const Icon = props.runtime ? RUNTIME_ICON[props.runtime] : null;
  if (props.kind !== "agent" || !Icon || props.size === 24) return face;
  return (
    <span className="relative inline-flex shrink-0">
      {face}
      <span
        aria-hidden="true"
        className="absolute -bottom-0.5 -right-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-agent text-on-agent ring-2 ring-surface"
      >
        <Icon size={10} strokeWidth={1.75} />
      </span>
    </span>
  );
}
