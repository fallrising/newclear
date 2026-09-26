import { Navigate, type RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { SiteShell } from "./shell";

// Pages are lazy route modules (01 §10.2); the shell is not.
export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/", lazy: async () => ({ Component: (await import("./pages/selector")).SelectorPage }) },
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/login")).FrontLoginPage }) },
      {
        element: <SiteShell site="album" />,
        children: [
          { path: "/album", lazy: async () => ({ Component: (await import("./pages/album")).AlbumHome }) },
          { path: "/album/albums", lazy: async () => ({ Component: (await import("./pages/album")).AlbumHome }) },
          { path: "/album/albums/:slug", lazy: async () => ({ Component: (await import("./pages/album")).AlbumDetail }) },
          { path: "/album/photos/:slug", lazy: async () => ({ Component: (await import("./pages/album")).PhotoPage }) },
        ],
      },
      {
        element: <SiteShell site="clinic" />,
        children: [{ path: "/clinic", lazy: async () => ({ Component: (await import("./pages/clinic")).ClinicHome }) }],
      },
      {
        element: <SiteShell site="projects" />,
        children: [
          { path: "/projects", lazy: async () => ({ Component: (await import("./pages/projects")).ProjectsHome }) },
          { path: "/projects/:slug", lazy: async () => ({ Component: (await import("./pages/projects")).ProjectDetail }) },
        ],
      },
      // v1 behaviour kept in W0; W3 replaces it with NotFoundPublic (C-04).
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
];
