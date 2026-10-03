import { Link } from "react-router";
import { Button, EmptyState, PageHeader } from "@cms/ui";
import { copy } from "../copy";

/** 01 §8: 403 inside Back. Reached by redirect from a type or entry the user cannot read. */
export function ForbiddenPage() {
  return (
    <>
      <PageHeader title={copy["forbidden.title"]} />
      <EmptyState testId="forbidden" title={copy["forbidden.title"]} description={copy["forbidden.body"]} action={<Button asChild variant="outline"><Link to="/">{copy["status.home"]}</Link></Button>} />
    </>
  );
}

/** 01 §8: 404 inside Back, distinct from 403. Also the catch-all route. */
export function NotFoundPage() {
  return (
    <>
      <PageHeader title={copy["notFound.title"]} />
      <EmptyState testId="not-found" title={copy["notFound.title"]} description={copy["notFound.body"]} action={<Button asChild variant="outline"><Link to="/">{copy["status.home"]}</Link></Button>} />
    </>
  );
}
