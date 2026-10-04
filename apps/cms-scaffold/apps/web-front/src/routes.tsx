import { MemberGate } from "./member-auth";
import { MemberHome, AppointmentDetail } from "./pages/member";
import { AppointmentNew } from "./pages/appointment-new";
import type { RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { SiteShell } from "./shell";
import { NotFoundPublic, StandaloneNotFound } from "./states";

// Pages are lazy route modules (01 §10.2); the shell and the not-found screens are not.
// Every public path of surface-front §4.2 except the member area (/clinic/me, /clinic/appointments/*: W3b).
export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/", lazy: async () => ({ Component: (await import("./pages/selector")).SelectorPage }) },
      { path: "/login", lazy: async () => ({ Component: (await import("./pages/login")).FrontLoginPage }) },
      { path: "/logout", lazy: async () => ({ Component: (await import("./pages/logout")).LogoutPage }) },
      {
        element: <SiteShell site="album" />,
        children: [
          { path: "/album", lazy: async () => ({ Component: (await import("./home")).AlbumHome }) },
          { path: "/album/albums", lazy: async () => ({ Component: (await import("./pages/album")).AlbumList }) },
          { path: "/album/albums/:slug", lazy: async () => ({ Component: (await import("./pages/album")).AlbumDetail }) },
          { path: "/album/photos/:slug", lazy: async () => ({ Component: (await import("./pages/album")).PhotoPage }) },
          { path: "/album/*", element: <NotFoundPublic /> },
        ],
      },
      {
        element: <SiteShell site="clinic" />,
        children: [
          { path: "/clinic", lazy: async () => ({ Component: (await import("./home")).ClinicHome }) },
          { path: "/clinic/vets", lazy: async () => ({ Component: (await import("./pages/clinic")).VetList }) },
          { path: "/clinic/vets/:slug", lazy: async () => ({ Component: (await import("./pages/clinic")).VetPage }) },
          { path: "/clinic/me", element: <MemberGate><MemberHome /></MemberGate> },
          { path: "/clinic/appointments/new", element: <MemberGate><AppointmentNew /></MemberGate> },
          { path: "/clinic/appointments/:id", element: <MemberGate><AppointmentDetail /></MemberGate> },
          { path: "/clinic/*", element: <NotFoundPublic /> },
        ],
      },
      {
        element: <SiteShell site="projects" />,
        children: [
          { path: "/projects", lazy: async () => ({ Component: (await import("./home")).ProjectsHome }) },
          { path: "/projects/:slug", lazy: async () => ({ Component: (await import("./pages/projects")).ProjectPage }) },
          { path: "/projects/:slug/milestones", lazy: async () => ({ Component: (await import("./pages/projects")).MilestoneList }) },
          { path: "/projects/:slug/milestones/:mSlug", lazy: async () => ({ Component: (await import("./pages/projects")).MilestonePage }) },
          { path: "/projects/*", element: <NotFoundPublic /> },
        ],
      },
      // C-04: an unknown path renders NotFoundPublic; it no longer redirects to "/".
      { path: "*", element: <StandaloneNotFound /> },
    ],
  },
];
