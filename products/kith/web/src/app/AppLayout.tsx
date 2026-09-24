import { Plus, Settings2 } from "lucide-react";
import { createContext, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router";
import type { Me } from "../api/types";
import { useT } from "../copy";
import { CreateRoomDialog, RoomList } from "../features/rooms";
import { IconButton } from "../ui/IconButton";
import { Wordmark } from "../ui/Wordmark";
import { UserMenu } from "./UserMenu";

export const CreateRoomContext = createContext<() => void>(() => {});

/** Signed-in layout: room sidebar + main area. On phones only one of them shows (`mobile`). */
export function AppLayout(props: { me: Me; mobile: "list" | "content"; children: ReactNode }): ReactElement {
  const t = useT();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <CreateRoomContext.Provider value={() => setCreateOpen(true)}>
      <div data-testid="app-shell" className="h-dvh flex bg-bg text-ink font-sans">
        <aside
          className={
            (props.mobile === "list" ? "flex" : "hidden") +
            " md:flex w-full md:w-68 shrink-0 flex-col bg-surface-2 border-r border-border"
          }
        >
          <div className="h-14 px-4 flex items-center justify-between">
            <Wordmark size="md" />
            {props.me.is_operator === 1 && (
              <div className="flex items-center gap-1">
                <IconButton data-testid="room-create-open" label={t("rooms.create.open")} icon={Plus} onClick={() => setCreateOpen(true)} />
                <Link
                  data-testid="console-link"
                  to="/console/people"
                  aria-label={t("console.open")}
                  title={t("console.open")}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2"
                >
                  <Settings2 size={20} strokeWidth={1.75} />
                </Link>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <RoomList />
          </div>
          <div className="h-14 px-2 flex items-center border-t border-border">
            <UserMenu me={props.me} />
          </div>
        </aside>
        <main className={(props.mobile === "content" ? "flex" : "hidden") + " md:flex flex-1 min-w-0 flex-col"}>
          {props.children}
        </main>
      </div>
      <CreateRoomDialog open={createOpen} onOpenChange={setCreateOpen} />
    </CreateRoomContext.Provider>
  );
}
