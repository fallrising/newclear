import type { ReactElement } from "react";
import { useT } from "../../copy";

export function NewDivider(): ReactElement {
  const t = useT();
  return (
    <div data-testid="timeline-new-divider" role="separator" className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-accent-strong">
      <span className="h-px flex-1 bg-accent" />
      <span>{t("timeline.newMessages")}</span>
      <span className="h-px flex-1 bg-accent" />
    </div>
  );
}
