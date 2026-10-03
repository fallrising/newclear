import type { ReactElement, Ref } from "react";

type TextFieldProps = {
  id: string;
  label: string;
  type: "text" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete: "username" | "current-password" | "new-password" | "off";
  disabled?: boolean;
  invalid?: boolean;
  /** id of the element that describes an error. */
  describedBy?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Put on the <input>. */
  "data-testid"?: string;
  autoCapitalize?: "none" | "sentences";
  spellCheck?: boolean;
  inputMode?: "text" | "numeric" | "decimal";
  placeholder?: string;
};

const INPUT =
  "h-11 px-3 rounded-md border border-border-strong bg-surface text-ink text-md-touch md:text-md " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus " +
  "aria-invalid:border-danger disabled:opacity-50";

export function TextField(props: TextFieldProps): ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.id} className="text-sm font-medium text-ink-2">
        {props.label}
      </label>
      <input
        id={props.id}
        ref={props.inputRef}
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoCapitalize={props.autoCapitalize}
        spellCheck={props.spellCheck}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        data-testid={props["data-testid"]}
        className={INPUT}
      />
    </div>
  );
}
