import { useEffect, useState, type ReactElement } from "react";
import { useT } from "../copy";
import { Button } from "./Button";

type CopyBlockProps = {
  label: string;
  value: string;
  "data-testid": string;
  multiline?: boolean;
};

export function CopyBlock(props: CopyBlockProps): ReactElement {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{props.label}</span>
      <pre
        data-testid={props["data-testid"]}
        className={
          "overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-sm text-ink" +
          (props.multiline ? " whitespace-pre-wrap" : "")
        }
      >
        {props.value}
      </pre>
      <Button variant="ghost" data-testid={props["data-testid"] + "-copy"} onClick={() => void copy()}>
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
    </div>
  );
}
