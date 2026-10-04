import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { workQueries, type WorkContentType, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { enumLabel, fieldLabel, formatDay, formatTime, RefValue } from "@cms/fields";
import { Button, EmptyState, fill, Input, Label, PageHeader, QueryBoundary, StatusBadge } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can } from "../nav";
import { useQueryParam, VIEW_PAGE_SIZE } from "./view-common";

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "YYYY-MM-DD" of a local date. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `?date=` as a local midnight; anything else (missing, malformed, impossible) is today in the browser's zone (C-09). */
export function readDay(value: string, now = new Date()): Date {
  const match = DAY.exec(value);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (dayKey(date) === value) return date;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** The UTC instants of a local day, [from, to) — the API range filter (BW1b §4.3, 01 §7.2 B-S7). */
export function dayRange(day: Date): { from: string; to: string } {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { from: day.toISOString(), to: next.toISOString() };
}

function shift(day: Date, days: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

function Visit({ visit, type }: { visit: WorkEntry; type: WorkContentType | undefined }) {
  const kind = type?.fields.find((f) => f.key === "visitKind");
  const refs = (["pet", "vet"] as const).flatMap((key) => {
    const field = type?.fields.find((f) => f.key === key);
    const id = visit.payload[key];
    return field && typeof id === "string" && id ? [{ field, id }] : [];
  });
  return (
    <li>
      <Link
        to={`/entries/visit/${visit.id}`}
        className="flex flex-col gap-1 rounded-xl border bg-surface p-4 hover:bg-accent sm:flex-row sm:items-start sm:gap-4"
        data-testid="schedule-visit"
      >
        <span className="w-14 shrink-0 font-semibold tabular-nums" data-testid="schedule-time">
          {formatTime(visit.payload.scheduledAt)}
        </span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong>{visit.title || copy["schedule.untitled"]}</strong>
            <StatusBadge state={visit.publicationState} dirty={visit.dirty} requested={visit.publishRequestedAt !== null} />
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-subdued">
            {refs.map(({ field, id }) => (
              <span key={field.key} className="inline-flex items-center gap-1">
                {fieldLabel(field)}
                {/* G-10: names come from the list's refs summary, no request per visit. */}
                <RefValue id={id} summary={visit.refs?.[field.key]} plain />
              </span>
            ))}
            {kind && typeof visit.payload.visitKind === "string" ? <span>{enumLabel(kind, visit.payload.visitKind)}</span> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** /views/clinic.schedule — B-S7: one local day of visits, from the API's date-range filter, oldest first. */
export function ClinicSchedulePage() {
  const me = useSession().me!;
  const [value, setValue] = useQueryParam("date");
  const day = readDay(value);
  const today = dayKey(readDay(""));
  const { from, to } = dayRange(day);
  const visitType = useQuery(workQueries.type(api.work, "visit"));
  const visits = useQuery(
    workQueries.entries(api.work, "visit", {
      filter: { "scheduledAt.from": from, "scheduledAt.to": to },
      sort: "scheduledAt",
      size: VIEW_PAGE_SIZE,
      include: "refs",
    }),
  );
  // Today is the default and is not written to the URL.
  const go = (date: Date) => setValue(dayKey(date) === today ? null : dayKey(date));
  const canCreate = can(me, "visit", "create");
  return (
    <>
      <PageHeader
        title={copy["view.clinic.schedule"]}
        primaryAction={canCreate ? { label: copy["schedule.newVisit"], to: "/entries/visit/new", testId: "schedule-new" } : undefined}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="schedule-date">{copy["schedule.date"]}</Label>
          <Input id="schedule-date" type="date" className="w-44" value={dayKey(day)} onChange={(event) => event.target.value && go(readDay(event.target.value))} />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => go(shift(day, -1))} data-testid="schedule-previous">
            {copy["schedule.previous"]}
          </Button>
          <Button type="button" variant="outline" onClick={() => go(shift(day, 1))} data-testid="schedule-next">
            {copy["schedule.next"]}
          </Button>
          <Button type="button" variant="outline" disabled={dayKey(day) === today} onClick={() => go(readDay(""))} data-testid="schedule-today">
            {copy["schedule.today"]}
          </Button>
        </div>
      </div>
      <h2 className="mb-3 text-card-title" data-testid="schedule-day">
        {formatDay(day)}
      </h2>
      <QueryBoundary
        query={visits}
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            testId="schedule-empty"
            title={copy["schedule.empty"]}
            description={copy["schedule.emptyBody"]}
            action={canCreate ? <Button asChild variant="outline"><Link to="/entries/visit/new">{copy["schedule.newVisit"]}</Link></Button> : undefined}
          />
        }
      >
        {(page) => (
          <>
            <p className="mb-2 text-subdued">{fill(copy["schedule.count"], { n: page.total })}</p>
            <ul className="flex flex-col gap-2">
              {page.items.map((visit) => (
                <Visit key={visit.id} visit={visit} type={visitType.data} />
              ))}
            </ul>
            {page.total > page.items.length ? <p className="mt-2 text-subdued">{fill(copy["schedule.more"], { n: page.items.length })}</p> : null}
          </>
        )}
      </QueryBoundary>
    </>
  );
}
