import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminQueries, keys, type AdminContentType } from "@cms/api";
import { Alert, AlertDescription, Badge, Button, Card, CardContent, EmptyState, PageHeader, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";

export function HomePage() {
  return (
    <>
      <PageHeader title={copy["home.title"]} />
      <p className="text-subdued">{copy["home.lead"]}</p>
    </>
  );
}

export function TypesPage() {
  const queryClient = useQueryClient();
  const types = useQuery(adminQueries.types(api.admin));
  // C-19 (no confirmation dialog) is fixed in W4.
  const toggle = useMutation({
    mutationFn: (type: AdminContentType) => (type.enabled ? api.admin.disableType(type.key) : api.admin.enableType(type.key)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.admin.types() }),
  });
  return (
    <>
      <PageHeader title={copy["types.title"]} />
      {toggle.isError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{copy["types.error"]}</AlertDescription>
        </Alert>
      ) : null}
      <QueryBoundary query={types} isEmpty={(list) => list.items.length === 0} empty={<EmptyState title={copy["types.empty"]} />}>
        {(list) => (
          <div className="flex flex-col gap-2">
            {list.items.map((type) => (
              <Card key={type.key} data-testid={`type-${type.key}`}>
                <CardContent className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <strong>{type.displayName}</strong>
                    <span className="text-subdued">{type.key}</span>
                    {type.enabled ? null : <Badge variant="secondary">{copy["types.disable"]}</Badge>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => toggle.mutate(type)} disabled={toggle.isPending}>
                    {type.enabled ? copy["types.disable"] : copy["types.enable"]}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

export function UsersPage() {
  const principals = useQuery(adminQueries.principals(api.admin));
  return (
    <>
      <PageHeader title={copy["users.title"]} />
      <QueryBoundary query={principals}>
        {(list) => (
          <ul className="flex flex-col gap-2">
            {list.items.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardContent>
                    {p.username} · {p.displayName} · {p.status}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
