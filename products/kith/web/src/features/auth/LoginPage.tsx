import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { useLogin, useMe } from "../../api/auth";
import { ApiError } from "../../api/client";
import { errorCopyKey } from "../../api/errors";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";
import { TextField } from "../../ui/TextField";
import { Wordmark } from "../../ui/Wordmark";
import { safeNext } from "./safeNext";

export function LoginPage(): ReactElement {
  const t = useT();
  const me = useMe();
  const login = useLogin();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [errorKey, setErrorKey] = useState<CopyKey | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  if (me.isSuccess) return <Navigate to={safeNext(params.get("next"))} replace />;

  const canSubmit = handle.trim() !== "" && password !== "" && !login.isPending;

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (handle.trim() === "" || password === "") return;
    setErrorKey(null);
    login.mutate(
      { handle: handle.trim(), password },
      {
        onSuccess: () => void navigate(safeNext(params.get("next")), { replace: true }),
        onError: (error) => {
          setErrorKey(
            error instanceof ApiError && error.status === 401 ? "auth.login.invalidCredentials" : errorCopyKey(error),
          );
          setPassword("");
          passwordRef.current?.focus();
        },
      },
    );
  };

  return (
    <main data-testid="login-page" className="min-h-dvh flex items-center justify-center bg-bg px-4 font-sans">
      <div className="w-full max-w-login bg-surface border border-border rounded-lg p-8 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Wordmark size="lg" />
          <h1 className="text-xl font-semibold text-ink">{t("auth.login.title")}</h1>
          <p className="text-sm text-ink-2">{t("auth.login.subtitle")}</p>
        </div>
        <form data-testid="login-form" noValidate className="flex flex-col gap-4" onSubmit={onSubmit}>
          <TextField
            id="login-handle"
            data-testid="login-handle"
            label={t("auth.login.handle")}
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={handle}
            onChange={setHandle}
          />
          <TextField
            id="login-password"
            data-testid="login-password"
            label={t("auth.login.password")}
            type="password"
            autoComplete="current-password"
            invalid={errorKey !== null}
            describedBy={errorKey ? "login-error" : undefined}
            inputRef={passwordRef}
            value={password}
            onChange={setPassword}
          />
          {errorKey && (
            <p id="login-error" data-testid="login-error" role="alert" className="text-sm text-danger">
              {t(errorKey)}
            </p>
          )}
          <Button variant="primary" type="submit" fullWidth data-testid="login-submit" disabled={!canSubmit}>
            {login.isPending ? t("auth.login.submitting") : t("auth.login.submit")}
          </Button>
        </form>
      </div>
    </main>
  );
}
