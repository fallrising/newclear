import { Link } from "react-router";
import { useQueries, useQuery } from "@tanstack/react-query";
import { workQueries, type WorkContentType } from "@cms/api";
import { useSession } from "@cms/auth";
import { Card, CardContent, EmptyState, fill, PageHeader, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can, viewsFor, workTypes } from "../nav";

function LinkCard({ to, title, detail, testId }: { to: string; title: string; detail: string; testId: string }) {
  return (
    <Link to={to} className="rounded-xl" data-testid={testId}>
      <Card className="h-full hover:bg-accent">
        <CardContent>
          <h3 className="text-card-title">{title}</h3>
          <p className="text-subdued">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

/**
 * surface-back §4.4 「待我發布」 (G-03): for each type the user may publish, how many entries wait for publishing.
 * One request per type (size 1, only `total` is read); the section appears when at least one count is above 0.
 */
function PublishRequests({ types }: { types: WorkContentType[] }) {
  const me = useSession().me!;
  const publishable = types.filter((t) => can(me, t.key, "publish"));
  const counts = useQueries({
    queries: publishable.map((t) => workQueries.entries(api.work, t.key, { publishRequested: true, size: 1 })),
  });
  const waiting = publishable.flatMap((t, i) => ((counts[i].data?.total ?? 0) > 0 ? [{ type: t, total: counts[i].data!.total }] : []));
  if (waiting.length === 0) return null;
  return (
    <section aria-labelledby="home-requests" data-testid="home-requests">
      <h2 id="home-requests" className="mb-2 text-card-title text-subdued">{copy["home.requests"]}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {waiting.map(({ type, total }) => (
          <LinkCard
            key={type.key}
            to={`/entries/${type.key}?publishRequested=true`}
            title={type.pluralDisplayName}
            detail={fill(copy["home.requestCount"], { n: total })}
            testId={`home-request-${type.key}`}
          />
        ))}
      </div>
    </section>
  );
}

/** 01 §7.2 Home: one card per workable type and per available view, all from capabilities (C-07). */
export function HomePage() {
  const me = useSession().me!;
  const schemas = useQuery(workQueries.types(api.work));
  const views = viewsFor(me);
  return (
    <>
      <PageHeader title={copy["home.title"]} />
      <p className="mb-4 text-subdued">{copy["home.lead"]}</p>
      <QueryBoundary
        query={schemas}
        isEmpty={(list) => workTypes(me, list.items).length === 0}
        empty={<EmptyState testId="home-empty" title={copy["home.noTypes"]} description={copy["home.noTypesBody"]} />}
      >
        {(list) => (
          <div className="flex flex-col gap-6">
            <PublishRequests types={workTypes(me, list.items)} />
            <section aria-labelledby="home-types">
              <h2 id="home-types" className="mb-2 text-card-title text-subdued">{copy["home.types"]}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workTypes(me, list.items).map((type) => (
                  <LinkCard key={type.key} to={`/entries/${type.key}`} title={type.pluralDisplayName} detail={type.displayName} testId={`home-type-${type.key}`} />
                ))}
              </div>
            </section>
            {views.length ? (
              <section aria-labelledby="home-views">
                <h2 id="home-views" className="mb-2 text-card-title text-subdued">{copy["home.views"]}</h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {views.map((view) => (
                    <LinkCard key={view.key} to={view.path} title={view.label} detail={view.lead} testId={`home-view-${view.key}`} />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
