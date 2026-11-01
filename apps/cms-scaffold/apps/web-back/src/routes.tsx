import { Navigate, useLocation, type RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";

/** /login is the v1 path; surface-back §4.2 makes /sign-in canonical (01 §13.2). The query string is kept. */
function LoginRedirect() {
  const location = useLocation();
  return <Navigate to={`/sign-in${location.search}`} replace />;
}

export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/sign-in", lazy: async () => ({ Component: (await import("./pages/sign-in")).SignInPage }) },
      { path: "/login", element: <LoginRedirect /> },
      {
        lazy: async () => ({ Component: (await import("./shell")).BackShell }),
        children: [
          { path: "/", lazy: async () => ({ Component: (await import("./pages/home")).HomePage }) },
          {
            lazy: async () => ({ Component: (await import("./pages/entry-layout")).EntryLayout }),
            children: [
              { path: "/entries/:type", lazy: async () => ({ Component: (await import("./pages/resource-index")).ResourceIndexPage }) },
              { path: "/entries/:type/new", lazy: async () => ({ Component: (await import("./pages/resource-details")).NewEntryPage }) },
              { path: "/entries/:type/:id", lazy: async () => ({ Component: (await import("./pages/resource-details")).EntryDetailsPage }) },
              { path: "/entries/:type/:id/preview", lazy: async () => ({ Component: (await import("./pages/preview")).EntryPreviewPage }) },
              { path: "/entries/:type/:id/history", lazy: async () => ({ Component: (await import("./pages/history")).EntryHistoryPage }) },
              { path: "/media", lazy: async () => ({ Component: (await import("./pages/media")).MediaLibraryPage }) },
              { path: "/media/:id", lazy: async () => ({ Component: (await import("./pages/media")).MediaDetailsPage }) },
              { path: "/views/album.composer", lazy: async () => ({ Component: (await import("./pages/composer")).AlbumComposerPage }) },
              { path: "/views/clinic.schedule", lazy: async () => ({ Component: (await import("./pages/schedule")).ClinicSchedulePage }) },
            ],
          },
          { path: "/views/projects.board", lazy: async () => ({ Component: (await import("./pages/board")).ProjectsBoardPage }) },
          { path: "/forbidden", lazy: async () => ({ Component: (await import("./pages/status")).ForbiddenPage }) },
          { path: "/not-found", lazy: async () => ({ Component: (await import("./pages/status")).NotFoundPage }) },
          { path: "*", lazy: async () => ({ Component: (await import("./pages/status")).NotFoundPage }) },
        ],
      },
    ],
  },
];
