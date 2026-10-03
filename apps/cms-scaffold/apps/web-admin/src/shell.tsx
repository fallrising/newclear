import { Outlet } from "react-router";
import { RequireSurface, useSession } from "@cms/auth";
import { AppFrame, PageHeader } from "@cms/ui";
import { copy } from "./copy";
import { ADMIN_NAV } from "./nav";

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
      product="admin"
      productName={copy["app.name"]}
      nav={ADMIN_NAV}
      account={{ displayName: me.principal.displayName, detail: me.roles.map((r) => r.code).join(", ") }}
      onSignOut={() => void session.signOut()}
    >
      <Outlet />
    </AppFrame>
  );
}

/** Every governance route: signed in (else /login?next=…), Admin surface (else forbidden), inside AppFrame. */
export function AdminShell() {
  return (
    <RequireSurface surface="admin" loginPath="/login" returnParam="next" forbidden={<Forbidden />}>
      <Frame />
    </RequireSurface>
  );
}
