import { Link } from "react-router";
import { Button, EmptyState, PageHeader } from "@cms/ui";
import { copy } from "../copy";

/** /403: the user is an admin-surface user without this governance action (surface-admin §4.5). */
export function ForbiddenPage() {
  return (
    <>
      <PageHeader title={copy["status.forbidden.title"]} />
      <EmptyState
        testId="forbidden"
        title={copy["status.forbidden.title"]}
        description={copy["status.forbidden.body"]}
        action={<Button asChild variant="outline"><Link to="/">{copy["status.home"]}</Link></Button>}
      />
    </>
  );
}

/** /404 and every unknown path, including /impersonate (surface-admin AC-I). */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title={copy["status.notFound.title"]} />
      <EmptyState
        testId="not-found"
        title={copy["status.notFound.title"]}
        description={copy["status.notFound.body"]}
        action={<Button asChild variant="outline"><Link to="/">{copy["status.home"]}</Link></Button>}
      />
    </>
  );
}
