import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Surface } from "@cms/api/public";
import { DefaultSkeleton, ErrorState } from "@cms/ui";
import { useSession } from "./session";

export interface RequireSurfaceProps {
  surface: Surface;
  /** For example "/sign-in" (Back) or "/login" (Admin). */
  loginPath: string;
  /** Query parameter carrying the current path: "returnTo" (Back) or "next" (Admin, Front). */
  returnParam: "returnTo" | "next";
  /** Rendered when the user is signed in but may not use this surface. */
  forbidden: ReactNode;
  children: ReactNode;
}

/** Route guard: loading → skeleton; anonymous → login with the current path; wrong surface → forbidden. */
export function RequireSurface({ surface, loginPath, returnParam, forbidden, children }: RequireSurfaceProps) {
  const session = useSession();
  const location = useLocation();
  if (session.status === "loading") {
    return (
      <div className="p-6">
        <DefaultSkeleton />
      </div>
    );
  }
  if (session.status === "error") {
    return (
      <div className="p-6">
        <ErrorState onRetry={session.retry} />
      </div>
    );
  }
  if (!session.me) {
    const here = `${location.pathname}${location.search}${location.hash}`;
    const target = here === "/" ? loginPath : `${loginPath}?${returnParam}=${encodeURIComponent(here)}`;
    return <Navigate to={target} replace />;
  }
  if (!session.me.surfaces[surface]) return <>{forbidden}</>;
  return <>{children}</>;
}
