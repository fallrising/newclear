import { useCallback, useEffect, useState } from "react";
import { getMe, parseMe } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { RoomListPage } from "./pages/RoomListPage";
import { RoomPage } from "./pages/RoomPage";
import type { Room } from "./types";

type Screen = { name: "boot" } | { name: "login" } | { name: "chat"; isOperator: boolean; handle: string };

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

function ChatShell({
  isOperator,
  handle,
  onLoggedOut,
}: {
  isOperator: boolean;
  handle: string;
  onLoggedOut: () => void;
}) {
  const wide = useWide();
  const [room, setRoom] = useState<Room | null>(null);
  const [createAsk, setCreateAsk] = useState(0);
  const showList = wide || room == null;
  const showRoom = wide || room != null;
  const list = (
    <RoomListPage
      operator={isOperator}
      selfHandle={handle}
      showLede={!wide}
      createAsk={createAsk}
      selectedId={room?.id}
      onOpenRoom={setRoom}
      onLoggedOut={onLoggedOut}
    />
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
              selfHandle={handle}
              showBack={!wide}
              onBack={() => setRoom(null)}
              onLoggedOut={onLoggedOut}
            />
          ) : (
            <main className="page page-empty">
              <div className="empty-copy">
                <h1>Select a room.</h1>
                <p>A room is one conversation. People and agents are members of it the same way.</p>
                <p>Pick one on the left to read it and to write into it.</p>
                <p className="kicker">What happens in a room</p>
                <ol>
                  <li>
                    Everyone in the room is listed under the room name. People and agents, with what each agent can
                    and cannot answer.
                  </li>
                  <li>
                    Type @ to mention a room member. A mention is talking to one member. It is not a promise that they
                    reply.
                  </li>
                  <li>
                    Invite by handle. The account has to exist already. A person you invite sees the room after they
                    refresh.
                  </li>
                </ol>
                {isOperator ? (
                  <button type="button" className="btn-primary" onClick={() => setCreateAsk((n) => n + 1)}>
                    New room
                  </button>
                ) : null}
              </div>
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
      setScreen({ name: "chat", isOperator: me.isOperator, handle: me.handle });
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
          setScreen({ name: "chat", isOperator: me.isOperator, handle: me.handle });
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
  return <ChatShell isOperator={screen.isOperator} handle={screen.handle} onLoggedOut={onLoggedOut} />;
}
