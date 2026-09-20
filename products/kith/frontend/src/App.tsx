import { useCallback, useEffect, useState } from "react";
import { getMe } from "./api";
import { LoginPage } from "./pages/LoginPage";
import { RoomListPage } from "./pages/RoomListPage";
import { RoomPage } from "./pages/RoomPage";
import type { Room } from "./types";

type Screen =
  | { name: "boot" }
  | { name: "login" }
  | { name: "rooms" }
  | { name: "room"; room: Room };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "boot" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await getMe();
        if (!cancelled) {
          setScreen({ name: "rooms" });
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

  const onLoggedIn = useCallback(() => setScreen({ name: "rooms" }), []);
  const onOpenRoom = useCallback((room: Room) => setScreen({ name: "room", room }), []);
  const onBack = useCallback(() => setScreen({ name: "rooms" }), []);
  const onLoggedOut = useCallback(() => setScreen({ name: "login" }), []);

  if (screen.name === "boot") {
    return (
      <main className="page">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (screen.name === "login") {
    return <LoginPage onLoggedIn={onLoggedIn} />;
  }
  if (screen.name === "rooms") {
    return <RoomListPage onOpenRoom={onOpenRoom} onLoggedOut={onLoggedOut} />;
  }
  return <RoomPage room={screen.room} onBack={onBack} onLoggedOut={onLoggedOut} />;
}
