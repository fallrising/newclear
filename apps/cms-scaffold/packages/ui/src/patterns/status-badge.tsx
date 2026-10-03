import { Badge } from "../components/ui/badge";
import { cn } from "../lib/utils";
import { uiCopy } from "../copy";

export type PublicationStateValue = "draft" | "published" | "archived";

const TONE: Record<PublicationStateValue, string> = {
  draft: "bg-surface-subdued text-foreground border-border",
  published: "bg-success-bg text-success border-transparent",
  archived: "bg-surface-subdued text-subdued border-border",
};

/** 01 §6.2: the publication state as a badge, plus "有未發布的變更" when a published entry is dirty. */
export function StatusBadge({ state, dirty = false }: { state: PublicationStateValue; dirty?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1" data-testid="status-badge" data-state={state}>
      <Badge variant="outline" className={cn("rounded-full", TONE[state])}>
        {uiCopy[`ui.status.${state}`]}
      </Badge>
      {state === "published" && dirty ? (
        <Badge variant="outline" className="rounded-full border-transparent bg-caution-bg text-caution">
          {uiCopy["ui.status.dirty"]}
        </Badge>
      ) : null}
    </span>
  );
}
