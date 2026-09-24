import type { ReactElement, ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useMe } from "../api/auth";
import { ApiError } from "../api/client";
import { errorCopyKey } from "../api/errors";
import { useT } from "../copy";
import { Button } from "../ui/Button";

export function RequireAuth(props: { children: ReactNode }): ReactElement {
  const me = useMe();
  const location = useLocation();
  const t = useT();

  if (me.isPending) {
    return (
      <div data-testid="app-loading" aria-busy="true" className="min-h-dvh bg-bg">
        <div className="h-14 bg-surface border-b border-border" />
        <span className="sr-only">{t("app.loading")}</span>
      </div>
    );
  }
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401) {
      return <Navigate to={"/login?next=" + encodeURIComponent(location.pathname + location.search)} replace />;
    }
    return (
      <div
        data-testid="app-error"
        role="alert"
        className="min-h-dvh bg-bg flex flex-col items-center justify-center gap-4 px-4"
      >
        <p className="text-md text-ink">{t(errorCopyKey(me.error))}</p>
        <Button variant="primary" data-testid="app-error-retry" onClick={() => void me.refetch()}>
          {t("error.retry")}
        </Button>
      </div>
    );
  }
  return <>{props.children}</>;
}
