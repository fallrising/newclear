import type { RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { AdminShell } from "./shell";

export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/login")).AdminLoginPage }) },
      {
        element: <AdminShell />,
        children: [
          { path: "/", lazy: async () => ({ Component: (await import("./pages/governance")).HomePage }) },
          { path: "/types", lazy: async () => ({ Component: (await import("./pages/governance")).TypesPage }) },
          { path: "/users", lazy: async () => ({ Component: (await import("./pages/governance")).UsersPage }) },
        ],
      },
    ],
  },
];
