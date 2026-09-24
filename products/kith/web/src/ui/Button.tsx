import type { ReactElement, ReactNode } from "react";

type ButtonProps = {
  variant: "primary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  "data-testid"?: string;
  fullWidth?: boolean;
};

const BASE =
  "inline-flex items-center justify-center h-10 px-4 rounded-md text-md font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANT: Record<ButtonProps["variant"], string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-strong disabled:hover:bg-accent",
  ghost: "bg-transparent text-ink-2 hover:bg-surface-2 disabled:hover:bg-transparent",
};

export function Button(props: ButtonProps): ReactElement {
  const className = BASE + " " + VARIANT[props.variant] + (props.fullWidth ? " w-full" : "");
  return (
    <button
      type={props.type ?? "button"}
      disabled={props.disabled}
      onClick={props.onClick}
      data-testid={props["data-testid"]}
      className={className}
    >
      {props.children}
    </button>
  );
}
