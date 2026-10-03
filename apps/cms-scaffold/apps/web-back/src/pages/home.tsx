import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { workQueries } from "@cms/api";
import { useSession } from "@cms/auth";
import { Card, CardContent, EmptyState, PageHeader, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { viewsFor, workTypes } from "../nav";

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
