import { LoginPage } from "@cms/auth";
import { TitleSuffixContext } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { BACK_RETURN_ROUTES } from "../nav";

export function SignInPage() {
  return (
    <TitleSuffixContext.Provider value={copy["app.name"]}>
      <LoginPage auth={api.auth} surface="back" title={copy["login.title"]} returnParam="returnTo" returnRoutes={BACK_RETURN_ROUTES} fallback="/" />
    </TitleSuffixContext.Provider>
  );
}
