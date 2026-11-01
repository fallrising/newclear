import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { DetailSkeleton, ErrorPublic } from "./states";
import { MemberForbidden } from "./pages/member";
import { useMemberSession } from "./member-session";

export { useMemberSession, useMemberUnauthorized } from "./member-session";

export function MemberGate({ children }: { children: ReactNode }) {
  const session = useMemberSession();
  const { pathname } = useLocation();
  if (session.isPending) return <DetailSkeleton />;
  if (session.isError) return <ErrorPublic level="page" onRetry={session.refetch} />;
  if (!session.data) return <Navigate replace to={"/login?next=" + encodeURIComponent(pathname)} />;
  if (!session.data.surfaces.front) return <MemberForbidden />;
  return <>
    {children}
  </>;
}
