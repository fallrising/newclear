import type { ReactElement } from "react";
import type { RoomSummary } from "../../api/types";
import { useLocale, useT } from "../../copy";
import type { RoomTimeline } from "../../sync/types";
import { Button } from "../../ui/Button";
import { formatDate } from "../../ui/time";

export function TimelineTop(props: { timeline: RoomTimeline; room: RoomSummary; hasMessages: boolean; onRetry: () => void }): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const tl = props.timeline;
  if (tl.loadingOlder) {
    return (
      <div data-testid="timeline-loading-older" className="py-4 text-center text-sm text-ink-3">
        {t("timeline.loadingOlder")}
      </div>
    );
  }
  if (tl.olderFailed) {
    return (
      <div data-testid="timeline-older-error" role="alert" className="py-4 text-center text-sm text-danger">
        {t("timeline.olderFailed")}{" "}
        <Button variant="ghost" data-testid="timeline-older-retry" onClick={props.onRetry}>
          {t("error.retry")}
        </Button>
      </div>
    );
  }
  if (!tl.hasMoreOlder && tl.phase !== "loading_latest") {
    return (
      <div data-testid="timeline-start" className="px-4 pt-8 pb-4">
        <h2 className="text-xl font-semibold text-ink">{t("timeline.start.title", { room: props.room.name })}</h2>
        <p className="text-sm text-ink-3">{t("timeline.start.created", { date: formatDate(props.room.created_at, locale) })}</p>
        {!props.hasMessages && (
          <p data-testid="timeline-empty" className="text-md text-ink-2 mt-2">
            {t("timeline.empty")}
          </p>
        )}
      </div>
    );
  }
  return <div data-testid="timeline-top" />;
}
