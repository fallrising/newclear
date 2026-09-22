import { useCallback, useEffect, useState } from "react";
import { ApiError, listRooms, logout } from "../api";
import type { Room } from "../types";

export function RoomListPage({
  onOpenRoom,
  onLoggedOut,
}: {
  onOpenRoom: (room: Room) => void;
  onLoggedOut: () => void;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRooms(await listRooms());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load rooms");
    } finally {
      setBusy(false);
    }
  }, [onLoggedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLogout() {
    try {
      await logout();
    } catch {
      // Session cookie is HttpOnly; still return to login.
    }
    onLoggedOut();
  }

  return (
    <main className="page">
      <div className="row">
        <span className="grow" />
        <button type="button" className="btn-quiet" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="btn-quiet" onClick={() => void onLogout()}>
          Log out
        </button>
      </div>
      <h1 className="large-title">Rooms</h1>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {busy && rooms.length === 0 ? <p className="muted">Loading…</p> : null}
      {!busy && rooms.length === 0 && !error ? <p className="muted">No rooms.</p> : null}
      <ul className="room-list">
        {rooms.map((room) => (
          <li key={room.id}>
            <button type="button" onClick={() => onOpenRoom(room)}>
              {room.name ?? room.slug ?? room.id}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
