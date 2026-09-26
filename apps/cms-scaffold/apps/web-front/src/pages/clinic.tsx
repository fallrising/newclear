import { useQuery } from "@tanstack/react-query";
import { publicQueries } from "@cms/api/public";
import { Card, CardContent, EmptyState, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { text } from "../media";
import { FrontTitle } from "../shell";

function Profile() {
  const profile = useQuery(publicQueries.bySlug(api.public, "clinic_profile", "home"));
  return (
    <QueryBoundary
      query={profile}
      notFound={
        <>
          <FrontTitle>{copy["clinic.fallbackTitle"]}</FrontTitle>
          <p className="mb-8 text-subdued">{copy["clinic.noProfile"]}</p>
        </>
      }
    >
      {(entry) => (
        <div className="mb-8">
          <FrontTitle>{entry.title ?? copy["clinic.fallbackTitle"]}</FrontTitle>
          <p className="text-subdued">{text(entry.payload.intro)}</p>
          {entry.payload.address ? <p className="mt-2">{text(entry.payload.address)}</p> : null}
          {entry.payload.hours ? <p className="text-subdued">{text(entry.payload.hours)}</p> : null}
        </div>
      )}
    </QueryBoundary>
  );
}

export function ClinicHome() {
  const vets = useQuery(publicQueries.entries(api.public, "vet"));
  return (
    <>
      <Profile />
      <h2 className="mb-3 font-display text-front-heading">{copy["clinic.vets"]}</h2>
      <QueryBoundary query={vets} isEmpty={(page) => page.items.length === 0} empty={<EmptyState title={copy["empty.vets"]} />}>
        {(page) => (
          <div className="grid gap-3 sm:grid-cols-2">
            {page.items.map((vet) => (
              <Card key={vet.id} data-testid="vet-card">
                <CardContent>
                  <h3 className="text-front-heading">{vet.title}</h3>
                  <p className="text-subdued">{text(vet.payload.specialty)}</p>
                  <p>{text(vet.payload.bio)}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}
