import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ApiError, listMembers, listMessages, logout } from "../api";
import {
  hasSeqGap,
  lastContinuousSeq,
  newClientMessageId,
  parseWsPacket,
  roomWebSocketUrl,
  sendPacket,
} from "../protocol";
import type { Member, Room, TimelineEvent } from "../types";

const TYPING_TTL_MS = 4000;

function senderLabel(event: TimelineEvent, members: Map<string, Member>): string {
  if (!event.sender_id) {
    return "message";
  }
  const member = members.get(event.sender_id);
  return member?.handle ?? member?.display_name ?? event.sender_id;
}

function memberLabel(memberId: string, members: Map<string, Member>): string {
  const member = members.get(memberId);
  return member?.handle ?? member?.display_name ?? memberId;
}

function memberName(member: Member): string {
  return member.handle ?? member.display_name ?? member.id;
}

function isOperatorOnly(member: Member): boolean {
  return member.quota_class === "operator_personal" || member.operator_only === true;
}

function MemberBadges({ member }: { member: Member }) {
  return (
    <>
      {member.kind ? <span className="badge">{member.kind}</span> : null}
      {isOperatorOnly(member) ? <span className="badge">operator-only</span> : null}
    </>
  );
}

export function RoomPage({
  room,
  onBack,
  onLoggedOut,
}: {
  room: Room;
  onBack: () => void;
  onLoggedOut: () => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(true);
  const eventsRef = useRef<Map<number, TimelineEvent>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimers = useRef<Map<string, number>>(new Map());

  function commitEvents() {
    setEvents([...eventsRef.current.values()].sort((a, b) => a.seq - b.seq));
  }

  function mergeEvents(incoming: TimelineEvent[]): number {
    let added = 0;
    for (const event of incoming) {
      if (!eventsRef.current.has(event.seq)) {
        eventsRef.current.set(event.seq, event);
        added += 1;
      }
    }
    if (added > 0) {
      commitEvents();
    }
    return added;
  }

  function noteStatus(memberId: string, statusBody: string) {
    setTyping((current) => ({ ...current, [memberId]: statusBody }));
    const prev = typingTimers.current.get(memberId);
    if (prev) {
      window.clearTimeout(prev);
    }
    const timer = window.setTimeout(() => {
      setTyping((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      typingTimers.current.delete(memberId);
    }, TYPING_TTL_MS);
    typingTimers.current.set(memberId, timer);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events, typing]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    eventsRef.current = new Map();
    setEvents([]);
    setTyping({});
    setError(null);
    setConnected(false);
    setBusy(true);

    let catchUpChain = Promise.resolve();

    async function catchUpGaps() {
      let guard = 0;
      while (!cancelled && guard < 16 && hasSeqGap(eventsRef.current.keys())) {
        guard += 1;
        const last = lastContinuousSeq(eventsRef.current.keys());
        if (last == null) {
          break;
        }
        const rows = await listMessages(room.id, { after_seq: last, limit: 50 }, ac.signal);
        if (mergeEvents(rows) === 0) {
          break;
        }
      }
    }

    function enqueueCatchUp() {
      catchUpChain = catchUpChain
        .then(async () => {
          if (!cancelled && hasSeqGap(eventsRef.current.keys())) {
            await catchUpGaps();
          }
        })
        .catch((err) => {
          if (!cancelled && !(err instanceof DOMException && err.name === "AbortError")) {
            setError(err instanceof Error ? err.message : "Failed to fill seq gap");
          }
        });
    }

    async function loadHistory() {
      try {
        const rows = await listMessages(room.id, { limit: 50 }, ac.signal);
        if (cancelled) {
          return;
        }
        mergeEvents(rows);
        enqueueCatchUp();
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onLoggedOut();
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load messages");
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void listMembers(room.id, ac.signal)
      .then((list) => {
        if (!cancelled) {
          setMembers(new Map(list.map((member) => [member.id, member])));
        }
      })
      .catch(() => {
        // Kind badge is optional.
      });

    void loadHistory();

    let retryTimer: number | undefined;

    function connect() {
      if (cancelled) {
        return;
      }
      const ws = new WebSocket(roomWebSocketUrl(room.id));
      wsRef.current = ws;
      ws.onopen = () => {
        if (cancelled) {
          return;
        }
        setConnected(true);
        enqueueCatchUp();
      };
      ws.onmessage = (message) => {
        if (cancelled || typeof message.data !== "string") {
          return;
        }
        const packet = parseWsPacket(message.data);
        if (!packet) {
          return;
        }
        if (packet.type === "event") {
          mergeEvents([packet.event]);
          enqueueCatchUp();
          return;
        }
        if (packet.type === "status") {
          noteStatus(packet.member_id, packet.body);
          return;
        }
        setError(packet.message ?? packet.code);
      };
      ws.onerror = () => {
        if (!cancelled) {
          setConnected(false);
        }
      };
      ws.onclose = () => {
        if (cancelled) {
          return;
        }
        setConnected(false);
        retryTimer = window.setTimeout(connect, 2000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      ac.abort();
      if (retryTimer) {
        window.clearTimeout(retryTimer);
      }
      wsRef.current?.close();
      wsRef.current = null;
      for (const timer of typingTimers.current.values()) {
        window.clearTimeout(timer);
      }
      typingTimers.current.clear();
    };
  }, [room.id, onLoggedOut]);

  async function onLogout() {
    try {
      await logout();
    } catch {
      // still return to login
    }
    onLoggedOut();
  }

  function submitBody() {
    const text = body.trim();
    if (!text) {
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Not connected");
      return;
    }
    const clientMessageId = newClientMessageId();
    ws.send(JSON.stringify(sendPacket(text, clientMessageId)));
    setBody("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submitBody();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitBody();
    }
  }

  const title = room.name ?? room.slug ?? room.id;

  return (
    <main className="page">
      <div className="row">
        <button type="button" onClick={onBack}>
          Rooms
        </button>
        <h1 className="grow">{title}</h1>
        <span className="muted">{connected ? "live" : "offline"}</span>
        <button type="button" onClick={() => void onLogout()}>
          Log out
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section className="members" aria-label="Members">
        <ul className="member-list">
          {[...members.values()].map((member) => (
            <li key={member.id}>
              <span>{memberName(member)}</span>
              <MemberBadges member={member} />
            </li>
          ))}
        </ul>
      </section>
      <section className="timeline" aria-live="polite">
        {busy && events.length === 0 ? <p className="muted">Loading…</p> : null}
        {!busy && events.length === 0 ? <p className="muted">No messages yet.</p> : null}
        {events.map((event) => {
          const member = event.sender_id ? members.get(event.sender_id) : undefined;
          return (
            <article key={event.seq} className="event">
              <div className="meta">
                <span>seq {event.seq}</span>
                <span>{senderLabel(event, members)}</span>
                {member ? <MemberBadges member={member} /> : null}
              </div>
              <p className="body">{event.body}</p>
            </article>
          );
        })}
        {Object.entries(typing).map(([memberId, statusBody]) => (
          <p key={memberId} className="status-line">
            {memberLabel(memberId, members)} {statusBody}
          </p>
        ))}
        <div ref={bottomRef} />
      </section>
      <form className="composer" onSubmit={onSubmit}>
        <textarea
          name="body"
          rows={2}
          maxLength={8192}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message"
        />
        <button type="submit" disabled={!body.trim() || !connected}>
          Send
        </button>
      </form>
    </main>
  );
}
