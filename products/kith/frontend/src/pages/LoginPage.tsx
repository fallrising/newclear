import { FormEvent, useState } from "react";
import { login } from "../api";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(handle.trim(), password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page-login">
      <h1>Kith</h1>
      <p className="muted">Sign in with handle and password.</p>
      <form onSubmit={onSubmit} aria-busy={busy}>
        <div className="grouped">
          <label>
            Handle
            <input
              name="handle"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
        </div>
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary" disabled={busy || !handle.trim() || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
