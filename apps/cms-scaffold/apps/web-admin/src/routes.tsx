import type { RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { Allow } from "./gate";
import { canGlobal, canSettings, hasAdminRole } from "./nav";


export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/login")).AdminLoginPage }) },
      {
        lazy: async () => ({ Component: (await import("./shell")).AdminShell }),
        children: [
          { path: "/", lazy: async () => ({ Component: (await import("./pages/overview")).OverviewPage }) },
          {
            element: <Allow when={(me) => canGlobal(me, "manage_types")} />,
            children: [
              { path: "/types", lazy: async () => ({ Component: (await import("./pages/types")).TypesPage }) },
              { path: "/types/:key", lazy: async () => ({ Component: (await import("./pages/types")).TypeDetailPage }) },
            ],
          },
          {
            element: <Allow when={(me) => canGlobal(me, "manage_principals")} />,
            children: [
              { path: "/roles", lazy: async () => ({ Component: (await import("./pages/roles")).RolesPage }) },
              { path: "/principals", lazy: async () => ({ Component: (await import("./pages/principals")).PrincipalsPage }) },
            ],
          },
          {
            // The matrix and the role fields list content types, so these pages also need manage_types (W4.md §4.7).
            element: <Allow when={(me) => canGlobal(me, "manage_principals") && canGlobal(me, "manage_types")} />,
            children: [
              { path: "/roles/:code", lazy: async () => ({ Component: (await import("./pages/roles")).RoleDetailPage }) },
              { path: "/principals/new", lazy: async () => ({ Component: (await import("./pages/principals")).PrincipalNewPage }) },
              { path: "/principals/:id", lazy: async () => ({ Component: (await import("./pages/principals")).PrincipalDetailPage }) },
            ],
          },
          {
            element: <Allow when={(me) => canGlobal(me, "read_audit")} />,
            children: [
              { path: "/audit", lazy: async () => ({ Component: (await import("./pages/audit")).AuditPage }) },
              { path: "/audit/:id", lazy: async () => ({ Component: (await import("./pages/audit")).AuditDetailPage }) },
            ],
          },
          {
            element: <Allow when={(me) => canGlobal(me, "manage_media")} />,
            children: [{ path: "/media", lazy: async () => ({ Component: (await import("./pages/media")).MediaPage }) }],
          },
          {
            element: <Allow when={canSettings} />,
            children: [{ path: "/settings", lazy: async () => ({ Component: (await import("./pages/settings")).SettingsPage }) }],
          },
          {
            element: <Allow when={(me) => canGlobal(me, "manage_settings")} />,
            children: [{ path: "/settings/audit", lazy: async () => ({ Component: (await import("./pages/settings")).AuditSettingsPage }) }],
          },
          {
            element: <Allow when={hasAdminRole} />,
            children: [
              { path: "/entries", lazy: async () => ({ Component: (await import("./pages/entries")).EntryLookupPage }) },
              { path: "/entries/:id", lazy: async () => ({ Component: (await import("./pages/entries")).EntryInspectorPage }) },
            ],
          },
          { path: "/403", lazy: async () => ({ Component: (await import("./pages/status")).ForbiddenPage }) },
          { path: "/404", lazy: async () => ({ Component: (await import("./pages/status")).NotFoundPage }) },
          // surface-admin §4.2: no /impersonate, /editor, /types/new …; every unknown path is the 404 page (AC-I).
          { path: "*", lazy: async () => ({ Component: (await import("./pages/status")).NotFoundPage }) },
        ],
      },
    ],
  },
];
