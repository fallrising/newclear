import { Navigate, Outlet } from "react-router";
import type { Me } from "@cms/api";
import { useSession } from "@cms/auth";

/** Route element: renders the child routes when `when(me)` holds, otherwise replaces the URL with /403 (surface-admin §4.5). */
export function Allow({ when }: { when: (me: Me) => boolean }) {
  const me = useSession().me!;
  return when(me) ? <Outlet /> : <Navigate to="/403" replace />;
}
