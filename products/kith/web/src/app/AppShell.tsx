import type { ReactElement, ReactNode } from "react";
import { useLogout } from "../api/auth";
import type { Me } from "../api/types";
import { useT } from "../copy";
import { Button } from "../ui/Button";
import { displayName } from "../ui/displayName";
import { Wordmark } from "../ui/Wordmark";

export function AppShell(props: { me: Me; children: ReactNode }): ReactElement {
  const t = useT();
  const logout = useLogout();
  return (
    <div data-testid="app-shell" className="min-h-dvh flex flex-col bg-bg text-ink font-sans">
      <header className="h-14 px-4 flex items-center justify-between bg-surface border-b border-border">
        <Wordmark size="md" />
        <div className="flex items-center gap-3">
          <span data-testid="app-shell-user" className="text-sm text-ink-2">
            {displayName(props.me)}
          </span>
          <Button
            variant="ghost"
            data-testid="app-shell-logout"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {t("app.shell.logout")}
          </Button>
        </div>
      </header>
      <main className="flex-1 flex">{props.children}</main>
    </div>
  );
}
