import { Outlet } from "react-router";
import { RequireSurface, useSession } from "@cms/auth";
import { AppFrame, PageHeader } from "@cms/ui";
import { copy } from "./copy";
import { navFor } from "./nav";

function Forbidden() {
  return (
    <main id="main" className="mx-auto max-w-xl p-6">
      <PageHeader title={copy["forbidden.title"]} />
      <p className="text-critical">{copy["forbidden.body"]}</p>
    </main>
  );
}

function Frame() {
  const session = useSession();
  const me = session.me!;
  return (
    <AppFrame
      product="back"
      productName={copy["app.name"]}
      nav={navFor(me)}
      account={{ displayName: me.principal.displayName, detail: me.roles.map((r) => r.code).join(", ") }}
      onSignOut={() => void session.signOut()}
    >
      <Outlet />
    </AppFrame>
  );
}

/** Every work route: signed in (else /sign-in?returnTo=…), Back surface (else forbidden), inside AppFrame. */
export function BackShell() {
  return (
    <RequireSurface surface="back" loginPath="/sign-in" returnParam="returnTo" forbidden={<Forbidden />}>
      <Frame />
    </RequireSurface>
  );
}
