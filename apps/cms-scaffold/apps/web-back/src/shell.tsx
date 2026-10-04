import { Outlet } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { workQueries } from "@cms/api";
import { RequireSurface, useSession } from "@cms/auth";
import { AppFrame, PageHeader } from "@cms/ui";
import { api } from "./api";
import { copy } from "./copy";
import { navFor } from "./nav";

function SurfaceForbidden() {
  return (
    <main id="main" className="mx-auto max-w-xl p-6">
      <PageHeader title={copy["surface.forbidden.title"]} />
      <p className="text-critical">{copy["surface.forbidden.body"]}</p>
    </main>
  );
}

const ROLE_KEYS = ["admin", "operator", "editor", "member"] as const;

function roleLabel(code: string): string {
  return (ROLE_KEYS as readonly string[]).includes(code) ? copy[`role.${code as (typeof ROLE_KEYS)[number]}`] : code;
}

function Frame() {
  const session = useSession();
  const me = session.me!;
  // Type labels (pluralDisplayName) come from the schema list; until it loads the nav shows 首頁 and 視圖 only.
  const types = useQuery(workQueries.types(api.work));
  return (
    <AppFrame
      product="back"
      productName={copy["app.name"]}
      nav={navFor(me, types.data?.items)}
      account={{ displayName: me.principal.displayName, detail: me.roles.map((r) => roleLabel(r.code)).join("、") }}
      onSignOut={() => void session.signOut()}
    >
      <Outlet />
    </AppFrame>
  );
}

/** Every work route: signed in (else /sign-in?returnTo=…), Back surface (else forbidden), inside AppFrame. */
export function BackShell() {
  return (
    <RequireSurface surface="back" loginPath="/sign-in" returnParam="returnTo" forbidden={<SurfaceForbidden />}>
      <Frame />
    </RequireSurface>
  );
}
