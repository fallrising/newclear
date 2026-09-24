import type { ReactElement } from "react";
import { useLocale, useT } from "../../copy";
import { dateLabel, localTimeZone } from "../../ui/time";

export function DateDivider(props: { date: string }): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const l = dateLabel(props.date, locale, new Date(), localTimeZone());
  const label = l.kind === "today" ? t("timeline.today") : l.kind === "yesterday" ? t("timeline.yesterday") : l.text;
  return (
    <div data-testid="date-divider" data-date={props.date} role="separator" className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-ink-3">
      <span className="h-px flex-1 bg-border" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
