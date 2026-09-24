import type { ReactElement } from "react";
import { useT } from "../../copy";
import { useTimelineStore } from "../../store/timeline";

/** Shown after more than CATCHUP_MAX_PAGES missed pages made RoomSync jump to the latest page. */
export function SyncNotice(props: { roomId: string; jumped: boolean }): ReactElement | null {
  const t = useT();
  if (!props.jumped) return null;
  return (
    <div
      data-testid="timeline-jumped"
      role="status"
      className="absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-surface border border-border px-4 py-1 text-sm text-ink-2 shadow-popover"
    >
      {t("timeline.jumped")}{" "}
      <button
        type="button"
        data-testid="timeline-jumped-dismiss"
        className="ml-2 text-accent-strong underline"
        onClick={() => useTimelineStore.getState().patch(props.roomId, { jumped: false })}
      >
        {t("timeline.dismiss")}
      </button>
    </div>
  );
}
