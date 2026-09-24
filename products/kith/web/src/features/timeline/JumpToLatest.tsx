import { ArrowDown } from "lucide-react";
import type { ReactElement } from "react";
import { useT } from "../../copy";

export function JumpToLatest(props: { count: number; onClick(): void }): ReactElement | null {
  const t = useT();
  if (props.count === 0) return null;
  return (
    <button
      type="button"
      data-testid="timeline-jump-latest"
      onClick={props.onClick}
      className="absolute bottom-3 right-4 inline-flex items-center gap-1 h-10 px-4 rounded-full bg-accent text-on-accent text-sm font-medium shadow-popover"
    >
      <ArrowDown size={16} aria-hidden /> {t("timeline.jumpLatest", { count: props.count })}
    </button>
  );
}
