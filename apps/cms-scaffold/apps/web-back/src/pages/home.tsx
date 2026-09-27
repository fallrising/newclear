import { Link } from "react-router";
import { useSession } from "@cms/auth";
import { Card, CardContent, PageHeader } from "@cms/ui";
import { copy } from "../copy";
import { allowedTypes, viewKeysFor } from "../nav";

export function HomePage() {
  const me = useSession().me!;
  const views = viewKeysFor(allowedTypes(me));
  return (
    <>
      <PageHeader title={copy["home.title"]} />
      <p className="mb-4 text-subdued">{copy["home.lead"]}</p>
      {views.length ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          {views.map((view) => (
            <Link key={view.key} to={view.path} className="rounded-xl">
              <Card className="h-full hover:bg-accent">
                <CardContent>
                  <h2 className="text-card-title">{view.label}</h2>
                  <p className="text-subdued">{view.key}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {me.roles.map((role) => (
          <Card key={role.code}>
            <CardContent>
              <strong>{role.code}</strong>
              <p className="text-subdued">{role.contentTypeCodes.join(", ") || copy["home.allTypes"]}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
