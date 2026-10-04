import { useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router";
import { isApiError, keys, type Me } from "@cms/api/public";
import { api } from "./api";
import { DetailSkeleton, ErrorPublic } from "./states";
import { MemberForbidden } from "./pages/member";

export function useMemberSession() {
  return useQuery({
    queryKey: keys.auth.me(), queryFn: async ({ signal }): Promise<Me | null> => {
      try { return await api.auth.me(signal); }
      catch (error) {
        if (isApiError(error) && error.status === 401) return null;
        throw error;
      }
    }, staleTime: Infinity
  });
}
export function useMemberUnauthorized(...errors: unknown[]) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const unauthorized = errors.some((error) => isApiError(error) && error.status === 401);
  useEffect(() => {
    if (!unauthorized) return;
    let active = true;
    void queryClient.cancelQueries({ queryKey: ["member"] }).then(() => {
      if (!active) return;
      queryClient.removeQueries({ queryKey: ["member"] });
      queryClient.setQueryData(keys.auth.me(), null);
      queryClient.setQueryData(keys.auth.expired(), false);
      navigate("/login?next=" + encodeURIComponent(pathname), { replace: true });
    });
    return () => { active = false; };
  }, [unauthorized, queryClient, navigate, pathname]);
  return unauthorized;
}
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
