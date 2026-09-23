import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, createRoom, listRooms, logout } from "../api";
import { slugFromName } from "../slug";
import type { Room } from "../types";

export function RoomListPage({
  onOpenRoom,
  onLoggedOut,
  operator = false,
  selectedId,
  selfHandle = "",
  showLede = false,
  createAsk = 0,
}: {
  onOpenRoom: (room: Room) => void;
  onLoggedOut: () => void;
  operator?: boolean;
  selectedId?: string;
  selfHandle?: string;
  showLede?: boolean;
  createAsk?: number;
}) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setBusy(true);
    setError(null);
    try {
      const next = await listRooms();
      if (seq !== loadSeq.current) {
        return;
      }
      setRooms(next);
    } catch (err) {
      if (seq !== loadSeq.current) {
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut();
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to load rooms");
    } finally {
      if (seq === loadSeq.current) {
        setBusy(false);
      }
    }
  }, [onLoggedOut]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (creating) {
      nameRef.current?.focus();
    }
  }, [creating]);

  useEffect(() => {
    if (createAsk > 0) {
      setCreating(true);
    }
  }, [createAsk]);

  async function onLogout() {
    try {
      await logout();
    } catch {
      // Session cookie is HttpOnly; still return to login.
    }
    onLoggedOut();
  }

  function closeCreate() {
    if (createBusy) {
      return;
    }
    setCreating(false);
    setCreateError(null);
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || createBusy) {
      return;
    }
    const sentSlug = slug.trim() || slugFromName(trimmed);
    setCreateBusy(true);
    setCreateError(null);
    try {
      const room = await createRoom(trimmed, sentSlug);
      setCreating(false);
      setName("");
      setSlug("");
      await load();
      onOpenRoom(room);
    } catch (err) {
      if (err instanceof ApiError && err.code === "handle_taken") {
        setSlug(sentSlug);
        slugRef.current?.focus();
      }
      setCreateError(err instanceof Error ? err.message : "Could not create room");
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div className="page page-rooms">
      <div className="row">
        <h1 className="large-title">Rooms</h1>
        <span className="grow" />
        <button type="button" className="btn-quiet" onClick={() => void load()} disabled={busy}>
          Refresh
        </button>
      </div>
      {showLede ? <p className="room-lede">Tap a room to read it and write into it.</p> : null}
      {operator ? (
        <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
          New room
        </button>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {busy && rooms.length === 0 ? <p className="muted">Loading…</p> : null}
      {!busy && rooms.length === 0 && !error ? (
        <>
          <p className="muted">No rooms.</p>
          {operator ? null : <p className="muted">An operator has to invite you.</p>}
        </>
      ) : null}
      <ul className="room-list">
        {rooms.map((room) => (
          <li key={room.id}>
            <button
              type="button"
              aria-current={room.id === selectedId ? "true" : undefined}
              onClick={() => onOpenRoom(room)}
            >
              {room.name ?? room.slug ?? room.id}
            </button>
          </li>
        ))}
      </ul>
      <div className="rail-id">
        <div>
          {selfHandle ? <div className="rail-handle">@{selfHandle}</div> : null}
          <div className="rail-role">{operator ? "operator" : "member"}</div>
        </div>
        <button type="button" className="btn-quiet" onClick={() => void onLogout()}>
          Log out
        </button>
      </div>
      {creating ? (
        <div className="sheet-backdrop" onMouseDown={closeCreate}>
          <div
            className="sheet"
            role="dialog"
            aria-labelledby="new-room-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeCreate();
              }
            }}
          >
            <h2 id="new-room-title">New room</h2>
            <form onSubmit={(event) => void onCreate(event)}>
              <label>
                Name
                <input
                  ref={nameRef}
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </label>
              <label>
                Slug
                <input
                  ref={slugRef}
                  name="slug"
                  value={slug}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setSlug(event.target.value)}
                />
              </label>
              {createError ? (
                <p className="error" role="alert">
                  {createError}
                </p>
              ) : null}
              <div className="sheet-actions">
                <button type="button" className="btn-quiet" onClick={closeCreate}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={createBusy || !name.trim()}>
                  {createBusy ? "Creating…" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
