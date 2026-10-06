import type { RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";

// Pages and site/member layouts are lazy route modules (01 §10.2).
// Every public path of surface-front §4.2 except the member area (/clinic/me, /clinic/appointments/*: W3b).
export const routes: RouteObject[] = [
  {
    HydrateFallback: DefaultSkeleton,
    children: [
      { path: "/", lazy: async () => ({ Component: (await import("./pages/selector")).SelectorPage }) },
      {
        lazy: async () => ({ Component: (await import("./api-route")).ApiRoute }),
        children: [
          { path: "/login", lazy: async () => ({ Component: (await import("./pages/login")).FrontLoginPage }) },
          { path: "/logout", lazy: async () => ({ Component: (await import("./pages/logout")).LogoutPage }) },
          {
            lazy: async () => ({ Component: (await import("./root-route")).RootRoute }),
            children: [
              { path: "/album", lazy: async () => ({ Component: (await import("./home")).AlbumHome }) },
              { path: "/album/albums", lazy: async () => ({ Component: (await import("./pages/album")).AlbumList }) },
              { path: "/album/albums/:slug", lazy: async () => ({ Component: (await import("./pages/album")).AlbumDetail }) },
              { path: "/album/photos/:slug", lazy: async () => ({ Component: (await import("./pages/album")).PhotoPage }) },
              { path: "/album/*", lazy: async () => ({ Component: (await import("./states")).NotFoundPublic }) },
            ],
          },
          {
            lazy: async () => ({ Component: (await import("./root-route")).RootRoute }),
            children: [
              { path: "/clinic", lazy: async () => ({ Component: (await import("./home")).ClinicHome }) },
              { path: "/clinic/vets", lazy: async () => ({ Component: (await import("./pages/clinic")).VetList }) },
              { path: "/clinic/vets/:slug", lazy: async () => ({ Component: (await import("./pages/clinic")).VetPage }) },
              {
                lazy: async () => ({ Component: (await import("./member-route")).MemberRoute }),
                children: [
                  { path: "/clinic/me", lazy: async () => ({ Component: (await import("./pages/member")).MemberHome }) },
                  { path: "/clinic/appointments/new", lazy: async () => ({ Component: (await import("./pages/appointment-new")).AppointmentNew }) },
                  { path: "/clinic/appointments/:id", lazy: async () => ({ Component: (await import("./pages/member")).AppointmentDetail }) },
                ],
              },
              { path: "/clinic/*", lazy: async () => ({ Component: (await import("./states")).NotFoundPublic }) },
            ],
          },
          {
            lazy: async () => ({ Component: (await import("./root-route")).RootRoute }),
            children: [
              { path: "/projects", lazy: async () => ({ Component: (await import("./home")).ProjectsHome }) },
              { path: "/projects/:slug", lazy: async () => ({ Component: (await import("./pages/projects")).ProjectPage }) },
              { path: "/projects/:slug/milestones", lazy: async () => ({ Component: (await import("./pages/projects")).MilestoneList }) },
              { path: "/projects/:slug/milestones/:mSlug", lazy: async () => ({ Component: (await import("./pages/projects")).MilestonePage }) },
              { path: "/projects/*", lazy: async () => ({ Component: (await import("./states")).NotFoundPublic }) },
            ],
          },
        ],
      },
      // C-04: an unknown path renders NotFoundPublic; it no longer redirects to "/".
      { path: "*", lazy: async () => ({ Component: (await import("./states")).StandaloneNotFound }) },
    ],
  },
];
