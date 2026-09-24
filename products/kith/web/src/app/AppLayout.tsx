import type { ReactElement, ReactNode } from "react";
import { useLogout } from "../api/auth";
import type { Me } from "../api/types";
import { useT } from "../copy";
import { RoomList } from "../features/rooms";
import { Button } from "../ui/Button";
import { displayName } from "../ui/displayName";
import { Wordmark } from "../ui/Wordmark";

/** Signed-in layout: room sidebar + main area. On phones only one of them shows (`mobile`). */
export function AppLayout(props: { me: Me; mobile: "list" | "content"; children: ReactNode }): ReactElement {
  const t = useT();
  const logout = useLogout();
  return (
    <div data-testid="app-shell" className="h-dvh flex bg-bg text-ink font-sans">
      <aside
        className={
          (props.mobile === "list" ? "flex" : "hidden") +
          " md:flex w-full md:w-68 shrink-0 flex-col bg-surface-2 border-r border-border"
        }
      >
        <div className="h-14 px-4 flex items-center">
          <Wordmark size="md" />
        </div>
        <div className="flex-1 overflow-y-auto">
          <RoomList />
        </div>
        <div className="h-14 px-4 flex items-center justify-between border-t border-border">
          <span data-testid="app-shell-user" className="text-sm text-ink-2 truncate">
            {displayName(props.me)}
          </span>
          <Button variant="ghost" data-testid="app-shell-logout" disabled={logout.isPending} onClick={() => logout.mutate()}>
            {t("app.shell.logout")}
          </Button>
        </div>
      </aside>
      <main className={(props.mobile === "content" ? "flex" : "hidden") + " md:flex flex-1 min-w-0 flex-col"}>{props.children}</main>
    </div>
  );
}
