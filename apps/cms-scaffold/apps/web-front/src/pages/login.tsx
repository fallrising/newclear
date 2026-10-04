import { LoginPage } from "@cms/auth";
import { TitleSuffixContext } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { usePageMeta } from "../seo";

/** Front member routes arrive with W3b (G-08); until then every `next` falls back to "/" (01 §13.2, AC-13). */
export const FRONT_RETURN_ROUTES: readonly string[] = [];

function LoginBody() {
  usePageMeta({ title: copy["login.title"], index: false });
  return <LoginPage auth={api.auth} surface="front" title={copy["login.title"]} returnParam="next" returnRoutes={FRONT_RETURN_ROUTES} fallback="/" />;
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
