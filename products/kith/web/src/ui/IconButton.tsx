import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

type IconButtonProps = {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  "data-testid"?: string;
  disabled?: boolean;
};

export function IconButton(props: IconButtonProps): ReactElement {
  const Icon = props.icon;
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      data-testid={props["data-testid"]}
      disabled={props.disabled}
      onClick={props.onClick}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </button>
  );
}
