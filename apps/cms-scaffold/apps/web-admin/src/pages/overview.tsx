import type { ReactNode } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { adminQueries, workQueries } from "@cms/api";
import { useSession } from "@cms/auth";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, fill, PageHeader, Progress, QueryBoundary, Skeleton } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { formatBytes, formatDateTime } from "../format";
import { actionLabel, actorLabel } from "../labels";
import { canGlobal } from "../nav";

const CARD_SKELETON = <Skeleton className="h-10 w-full" />;

/** surface-admin §4.4 quota bar: 80% or more shows the caution line. */
export const QUOTA_WARNING = 0.8;

function SummaryCard({ title, testId, to, linkLabel, children }: { title: string; testId: string; to: string; linkLabel: string; children: ReactNode }) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-card-title">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {children}
        <Link to={to} className="text-table hover:underline">
          {linkLabel}
        </Link>
      </CardContent>
    </Card>
  );
}

function TypesSummary() {
  const types = useQuery(adminQueries.types(api.admin));
  return (
    <SummaryCard title={copy["overview.types"]} testId="overview-types" to="/types" linkLabel={copy["overview.types.link"]}>
      <QueryBoundary query={types} skeleton={CARD_SKELETON}>
        {(list) => (
          <p>{fill(copy["overview.types.count"], { total: list.items.length, disabled: list.items.filter((t) => !t.enabled).length })}</p>
        )}
      </QueryBoundary>
    </SummaryCard>
  );
}

function PrincipalsSummary() {
  const principals = useQuery(adminQueries.principals(api.admin));
  return (
    <SummaryCard title={copy["overview.principals"]} testId="overview-principals" to="/principals" linkLabel={copy["overview.principals.link"]}>
      <QueryBoundary query={principals} skeleton={CARD_SKELETON}>
        {(list) => (
          <p>
            {fill(copy["overview.principals.count"], {
              total: list.items.length,
              inactive: list.items.filter((p) => p.status !== "active").length,
            })}
          </p>
        )}
      </QueryBoundary>
    </SummaryCard>
  );
}

function MediaSummary() {
  const quota = useQuery(workQueries.mediaQuota(api.work));
  return (
    <SummaryCard title={copy["overview.media"]} testId="overview-media" to="/media" linkLabel={copy["overview.media.link"]}>
      <QueryBoundary query={quota} skeleton={CARD_SKELETON}>
        {(q) => {
          const ratio = q.maxLibraryBytes > 0 ? q.usedBytes / q.maxLibraryBytes : 0;
          return (
            <>
              <Progress value={Math.min(100, ratio * 100)} aria-label={copy["overview.media"]} />
              <p>{fill(copy["overview.media.usage"], { used: formatBytes(q.usedBytes), max: formatBytes(q.maxLibraryBytes) })}</p>
              {ratio >= QUOTA_WARNING ? <p className="text-caution">{copy["media.warning"]}</p> : null}
            </>
          );
        }}
      </QueryBoundary>
    </SummaryCard>
  );
}

function RecentAudit() {
  const events = useQuery(adminQueries.audit(api.admin, { size: 10 }));
  return (
    <Card data-testid="overview-audit">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-card-title">{copy["overview.audit"]}</CardTitle>
        <Link to="/audit" className="text-table hover:underline">
          {copy["overview.audit.link"]}
        </Link>
      </CardHeader>
      <CardContent>
        <QueryBoundary query={events} isEmpty={(page) => page.items.length === 0} empty={<p className="text-subdued">{copy["overview.audit.empty"]}</p>}>
          {(page) => (
            <ul className="flex flex-col divide-y">
              {page.items.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-table" data-testid="overview-audit-row">
                  <span className="text-subdued">{formatDateTime(event.at)}</span>
                  <span>{actorLabel(event.actor)}</span>
                  <Link to={`/audit/${event.id}`} className="hover:underline">
                    {actionLabel(event.action)}
                  </Link>
                  {event.outcome === "denied" ? <span className="text-critical">{copy["audit.outcome.denied"]}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </QueryBoundary>
      </CardContent>
    </Card>
  );
}

/** surface-admin AC-L: zero content types is an empty state, not a crash or a 500. */
function NoTypes() {
  const types = useQuery(adminQueries.types(api.admin));
  if (!types.data || types.data.items.length > 0) return null;
  return (
    <EmptyState
      testId="overview-no-types"
      title={copy["types.none.title"]}
      description={copy["types.none.body"]}
      action={<Button asChild variant="outline"><Link to="/types">{copy["overview.types.link"]}</Link></Button>}
    />
  );
}

/** 01 A-S1: summary cards and the latest governance events; each part only with its capability. */
export function OverviewPage() {
  const me = useSession().me!;
  const cards = [
    canGlobal(me, "manage_types") ? <TypesSummary key="types" /> : null,
    canGlobal(me, "manage_principals") ? <PrincipalsSummary key="principals" /> : null,
    canGlobal(me, "manage_media") ? <MediaSummary key="media" /> : null,
  ].filter(Boolean);
  return (
    <>
      <PageHeader title={copy["overview.title"]} />
      <p className="mb-4 text-subdued">{copy["overview.lead"]}</p>
      <div className="flex flex-col gap-4">
        {canGlobal(me, "manage_types") ? <NoTypes /> : null}
        {cards.length > 0 ? <div className="grid gap-4 md:grid-cols-3">{cards}</div> : null}
        {canGlobal(me, "read_audit") ? <RecentAudit /> : null}
        {cards.length === 0 && !canGlobal(me, "read_audit") ? (
          <Alert>
            <AlertDescription>{copy["overview.nothing"]}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </>
  );
}
