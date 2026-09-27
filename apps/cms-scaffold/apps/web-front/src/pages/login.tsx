import { LoginPage } from "@cms/auth";
import { TitleSuffixContext } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";

/** Front member routes arrive with W3b (G-08); until then every `next` falls back to "/" (01 §13.2, AC-13). */
export const FRONT_RETURN_ROUTES: readonly string[] = [];

export function FrontLoginPage() {
  return (
    <TitleSuffixContext.Provider value={copy["selector.title"]}>
      <div data-scheme="selector">
        <LoginPage auth={api.auth} surface="front" title={copy["login.title"]} returnParam="next" returnRoutes={FRONT_RETURN_ROUTES} fallback="/" />
      </div>
    </TitleSuffixContext.Provider>
  );
}
