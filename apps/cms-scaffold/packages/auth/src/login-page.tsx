import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, type AuthApi, type Me, type Surface } from "@cms/api/public";
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useDocumentTitle } from "@cms/ui";
import { authCopy, type AuthCopyKey } from "./copy";
import { safeReturnTo } from "./return-to";
import { useOptionalSession } from "./session";

export interface LoginPageProps {
  auth: AuthApi;
  surface: Surface;
  /** Heading, for example "登入 CMS 作業台". */
  title: string;
  returnParam: "returnTo" | "next";
  /** Route patterns accepted as a return target (safeReturnTo). */
  returnRoutes: readonly string[];
  /** Where to go when the return target is missing or rejected. */
  fallback: string;
}

function errorKey(error: unknown): AuthCopyKey {
  if (!isApiError(error)) return "auth.login.error.generic";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "auth.login.error.credentials";
    case "ACCOUNT_LOCKED":
      return "auth.login.error.locked";
    case "ACCOUNT_DISABLED":
      return "auth.login.error.disabled";
    case "VALIDATION_FAILED":
      return "auth.login.error.required";
    default:
      return "auth.login.error.generic";
  }
}

/** Shared login form (E-01). Fields start empty: no seed account names in the bundle (S-02). */
export function LoginPage({ auth, surface, title, returnParam, returnRoutes, fallback }: LoginPageProps) {
  useDocumentTitle(title);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<AuthCopyKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useOptionalSession();
  const target = safeReturnTo(params.get(returnParam), returnRoutes, fallback);

  if (session?.me?.surfaces[surface]) return <Navigate to={target} replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("auth.login.error.required");
      return;
    }
    setSubmitting(true);
    try {
      const result = await auth.login(username.trim(), password);
      const me: Me = { principal: result.principal, roles: result.roles, surfaces: result.surfaces };
      if (!me.surfaces[surface]) {
        setError("auth.login.error.noSurface");
        return;
      }
      queryClient.setQueryData(keys.auth.me(), me);
      navigate(target, { replace: true });
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1 className="text-page-title">{title}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            {error ? (
              <Alert variant="destructive" data-testid="login-error">
                <AlertDescription>{authCopy[error]}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-username">{authCopy["auth.login.username"]}</Label>
              <Input
                id="login-username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">{authCopy["auth.login.password"]}</Label>
              <Input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting} data-testid="login-submit">
              {submitting ? authCopy["auth.login.submitting"] : authCopy["auth.login.submit"]}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
