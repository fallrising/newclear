import { Navigate, useLocation, type RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { BackShell } from "./shell";

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
        element: <BackShell />,
        children: [
          { path: "/", lazy: async () => ({ Component: (await import("./pages/home")).HomePage }) },
          { path: "/entries/:type", lazy: async () => ({ Component: (await import("./pages/entries")).EntryListPage }) },
          { path: "/entries/:type/new", lazy: async () => ({ Component: (await import("./pages/entries")).EntryEditorPage }) },
          { path: "/entries/:type/:id", lazy: async () => ({ Component: (await import("./pages/entries")).EntryEditorPage }) },
          { path: "/views/album.composer", lazy: async () => ({ Component: (await import("./pages/views")).AlbumComposerPage }) },
          { path: "/views/clinic.schedule", lazy: async () => ({ Component: (await import("./pages/views")).ClinicSchedulePage }) },
          { path: "/views/projects.board", lazy: async () => ({ Component: (await import("./pages/views")).ProjectsBoardPage }) },
        ],
      },
    ],
  },
];
