import { useCallback, useEffect, useState } from "react";
import { getMe, parseMe } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { RoomListPage } from "./pages/RoomListPage";
import { RoomPage } from "./pages/RoomPage";
import type { Room } from "./types";

type Screen = { name: "boot" } | { name: "login" } | { name: "chat"; isOperator: boolean };

function readWide(): boolean {
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(min-width: 768px)").matches;
}

function useWide(): boolean {
  const [wide, setWide] = useState(readWide);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return wide;
}

function ChatShell({ isOperator, onLoggedOut }: { isOperator: boolean; onLoggedOut: () => void }) {
  const wide = useWide();
  const [room, setRoom] = useState<Room | null>(null);
  const showList = wide || room == null;
  const showRoom = wide || room != null;
  const list = (
    <RoomListPage operator={isOperator} selectedId={room?.id} onOpenRoom={setRoom} onLoggedOut={onLoggedOut} />
  );
  return (
    <div className={wide ? "shell shell-wide" : "shell"}>
      {showList ? (
        wide ? (
          <aside className="shell-list">{list}</aside>
        ) : (
          <div className="shell-list" role="main">
            {list}
          </div>
        )
      ) : null}
      {showRoom ? (
        <div className="shell-main">
          {room ? (
            <RoomPage
              room={room}
              operator={isOperator}
              showBack={!wide}
              onBack={() => setRoom(null)}
              onLoggedOut={onLoggedOut}
            />
          ) : (
            <main className="page page-empty">
              <p className="muted">Select a room.</p>
            </main>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });

  const enterChat = useCallback(async () => {
    try {
      const me = parseMe(await getMe());
      setScreen({ name: "chat", isOperator: me.isOperator });
    } catch {
      setScreen({ name: "login" });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = parseMe(await getMe());
        if (!cancelled) {
          setScreen({ name: "chat", isOperator: me.isOperator });
        }
      } catch {
        if (!cancelled) {
          setScreen({ name: "login" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoggedOut = useCallback(() => setScreen({ name: "login" }), []);

  if (screen.name === "boot") {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (screen.name === "login") {
    return <LoginPage onLoggedIn={() => void enterChat()} />;
  }
  return <ChatShell isOperator={screen.isOperator} onLoggedOut={onLoggedOut} />;
}
