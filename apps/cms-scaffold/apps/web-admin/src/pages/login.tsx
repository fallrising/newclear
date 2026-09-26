import { LoginPage } from "@cms/auth";
import { TitleSuffixContext } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { ADMIN_RETURN_ROUTES } from "../nav";

export function AdminLoginPage() {
  return (
    <TitleSuffixContext.Provider value={copy["app.name"]}>
      <LoginPage auth={api.auth} surface="admin" title={copy["login.title"]} returnParam="next" returnRoutes={ADMIN_RETURN_ROUTES} fallback="/" />
    </TitleSuffixContext.Provider>
  );
}
