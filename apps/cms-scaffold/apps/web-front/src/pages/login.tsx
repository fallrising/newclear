import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { LoginPage } from "@cms/auth";
import { TitleSuffixContext } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { usePageMeta } from "../seo";

/** Only registered member paths can be a login return target. */
export const FRONT_RETURN_ROUTES: readonly string[] = ["/clinic/me", "/clinic/appointments/new", "/clinic/appointments/:id"];

function LoginBody() {
  const [params] = useSearchParams();
  const queryClient = useQueryClient();
  const next = params.get("next");
  const valid = next !== null && (/^\/clinic\/me$/.test(next) || /^\/clinic\/appointments\/(new|[a-zA-Z0-9-]+)$/.test(next));
  const returnRoutes = valid ? FRONT_RETURN_ROUTES : [];
  useEffect(() => { void queryClient.cancelQueries({ queryKey: ["member"] }).then(() => queryClient.removeQueries({ queryKey: ["member"] })); }, [queryClient]);
  usePageMeta({ title: copy["login.title"], index: false });
  return <LoginPage auth={api.auth} surface="front" title={copy["login.title"]} returnParam="next" returnRoutes={returnRoutes} fallback="/clinic/me" />;
}

export function FrontLoginPage() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector">
        <LoginBody />
      </div>
    </TitleSuffixContext.Provider>
  );
}
