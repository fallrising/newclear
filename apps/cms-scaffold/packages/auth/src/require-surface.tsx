import { useEffect, useRef, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
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

/** Keep the signed-in subtree mounted while expiry navigation passes through its blockers. */
function SignedIn({ expired, loginTarget, children }: { expired: boolean; loginTarget: string; children: ReactNode }) {
  const navigate = useNavigate();
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!expired) {
      tried.current = null;
      return;
    }
    if (tried.current === loginTarget) return;
    tried.current = loginTarget;
    void navigate(loginTarget, { replace: true });
  }, [expired, navigate, loginTarget]);
  return <>{children}</>;
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
  const here = `${location.pathname}${location.search}${location.hash}`;
  const target = here === "/" ? loginPath : `${loginPath}?${returnParam}=${encodeURIComponent(here)}`;
  if (!session.me) return <Navigate to={target} replace />;
  return <SignedIn expired={session.status === "expired"} loginTarget={target}>
    {session.me.surfaces[surface] ? children : forbidden}
  </SignedIn>;
}
