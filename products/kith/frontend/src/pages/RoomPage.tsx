import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ApiError, inviteHuman, listMembers, listMessages } from "../api";
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
    return event.kind || "system";
  }
  const member = members.get(event.sender_id);
  return member?.handle ?? member?.display_name ?? event.sender_id;
}

function formatClock(iso?: string): string | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function continuesFrom(prev: TimelineEvent | undefined, event: TimelineEvent): boolean {
  if (!prev || !event.sender_id || prev.sender_id !== event.sender_id) {
    return false;
  }
  if (!prev.created_at || !event.created_at) {
    return true;
  }
  const a = Date.parse(prev.created_at);
  const b = Date.parse(event.created_at);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return true;
  }
  return b - a < 5 * 60 * 1000;
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
      {isOperatorOnly(member) ? <span className="badge badge-operator">operator-only</span> : null}
    </>
  );
}

function composerCapPx(el: HTMLTextAreaElement): number {
  const raw = getComputedStyle(el).maxHeight;
  if (raw.endsWith("px")) {
    const px = Number.parseFloat(raw);
    if (Number.isFinite(px) && px > 0) {
      return px;
    }
  }
  return Math.round((window.innerHeight || 800) * 0.4);
}

function fitComposer(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  const scroll = el.scrollHeight;
  if (scroll <= 0) {
    el.style.height = "";
    return;
  }
  const max = composerCapPx(el);
  el.style.height = `${Math.min(scroll, max)}px`;
  el.style.overflowY = scroll > max ? "auto" : "hidden";
}

export function RoomPage({
  room,
  onBack,
  onLoggedOut,
  operator = false,
  showBack = true,
}: {
  room: Room;
  onBack: () => void;
  onLoggedOut: () => void;
  operator?: boolean;
  showBack?: boolean;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [members, setMembers] = useState<Map<string, Member>>(new Map());
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<"connecting" | "live" | "offline">("connecting");
  const [busy, setBusy] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteHandle, setInviteHandle] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const eventsRef = useRef<Map<number, TimelineEvent>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const timelineRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const inviteRef = useRef<HTMLInputElement>(null);
  const pinBottom = useRef(true);
  const typingTimers = useRef<Map<string, number>>(new Map());
  const connected = link === "live";

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
    const el = timelineRef.current;
    if (!el || !pinBottom.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [events]);

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    eventsRef.current = new Map();
    setEvents([]);
    setTyping({});
    setError(null);
    setNotice(null);
    setInviteOpen(false);
    setMembersLoaded(false);
    setLink("connecting");
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
      })
      .finally(() => {
        if (!cancelled) {
          setMembersLoaded(true);
        }
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
        setLink("live");
        setError((current) => (current === "Not connected" ? null : current));
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
          setLink("offline");
        }
      };
      ws.onclose = () => {
        if (cancelled) {
          return;
        }
        setLink("offline");
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
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      submitBody();
    }
  }

  const title = room.name ?? room.slug ?? room.id;

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Kith`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  const linkLabel = link === "live" ? "live" : link === "connecting" ? "connecting" : "offline";
  const peopleLabel = membersLoaded ? `${members.size} ${members.size === 1 ? "person" : "people"}` : null;

  useEffect(() => {
    if (composerRef.current) {
      fitComposer(composerRef.current);
    }
  }, [body]);

  useEffect(() => {
    if (inviteOpen) {
      inviteRef.current?.focus();
    }
  }, [inviteOpen]);

  function closeInvite() {
    if (inviteBusy) {
      return;
    }
    setInviteOpen(false);
    setInviteError(null);
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    const handle = inviteHandle.trim();
    if (!handle || inviteBusy) {
      return;
    }
    setInviteBusy(true);
    setInviteError(null);
    try {
      await inviteHuman(room.id, handle);
      setInviteOpen(false);
      setInviteHandle("");
      setNotice("They will see this room after they refresh.");
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not invite");
    } finally {
      setInviteBusy(false);
    }
  }

  function onTimelineScroll() {
    const el = timelineRef.current;
    if (!el) {
      return;
    }
    pinBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }

  return (
    <main className="page page-room">
      <div className="row">
        {showBack ? (
          <button type="button" className="btn-back" onClick={onBack} aria-label="Back to rooms">
            <span className="chev" aria-hidden="true" />
            Rooms
          </button>
        ) : (
          <span />
        )}
        <div className="title-block">
          <h1 className="grow">{title}</h1>
          <span
            className={link === "live" ? "conn conn-live" : link === "offline" ? "conn conn-offline" : "conn"}
            role="status"
          >
            {linkLabel}
          </span>
        </div>
        <span />
      </div>
      <div className="room-tools">
        {peopleLabel ? (
          <details className="people">
            <summary>{peopleLabel}</summary>
            <ul className="member-list" aria-label="Members">
              {[...members.values()].map((member) => (
                <li key={member.id}>
                  <span>{memberName(member)}</span>
                  <MemberBadges member={member} />
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <span />
        )}
        {operator ? (
          <button type="button" className="btn-quiet" onClick={() => setInviteOpen(true)}>
            Invite
          </button>
        ) : null}
      </div>
      {notice ? <p className="muted room-note">{notice}</p> : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <section
        className="timeline"
        ref={timelineRef}
        role="log"
        aria-label={`${title} messages`}
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={busy}
        onScroll={onTimelineScroll}
      >
        {busy && events.length === 0 ? <p className="muted">Loading…</p> : null}
        {!busy && events.length === 0 ? <p className="muted">No messages yet.</p> : null}
        {events.map((event, index) => {
          const member = event.sender_id ? members.get(event.sender_id) : undefined;
          const cont = continuesFrom(events[index - 1], event);
          const clock = formatClock(event.created_at);
          if (!event.sender_id) {
            return (
              <p key={event.seq} className="event-system" title={`seq ${event.seq}`}>
                {event.body || event.kind}
              </p>
            );
          }
          return (
            <article
              key={event.seq}
              className={cont ? "event cont" : "event"}
              data-kind={member?.kind}
              title={`seq ${event.seq}`}
            >
              {cont ? (
                <span className="sr-only">{senderLabel(event, members)}: </span>
              ) : (
                <div className="meta">
                  <span className="who">{senderLabel(event, members)}</span>
                  {clock ? <time dateTime={event.created_at}>{clock}</time> : null}
                  {member ? <MemberBadges member={member} /> : null}
                  <span className="seq" aria-hidden="true">
                    {event.seq}
                  </span>
                </div>
              )}
              <p className="body">{event.body}</p>
            </article>
          );
        })}
      </section>
      <div className="status-slot">
        {Object.entries(typing).map(([memberId, statusBody]) => (
          <p key={memberId} className="status-line">
            {memberLabel(memberId, members)} {statusBody}
          </p>
        ))}
      </div>
      {link === "offline" ? <p className="conn-banner">Offline. Reconnecting…</p> : null}
      <form className="composer" onSubmit={onSubmit}>
        <p id="composer-hint" className="composer-hint">
          Enter to send · Shift+Enter for a new line
        </p>
        <div className="composer-row">
          <textarea
            ref={composerRef}
            name="body"
            rows={1}
            maxLength={8192}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            aria-label={`Message ${title}`}
            aria-describedby="composer-hint"
          />
          <button type="submit" className="btn-primary" disabled={!body.trim() || !connected}>
            Send
          </button>
        </div>
      </form>
      {inviteOpen ? (
        <div className="sheet-backdrop" onMouseDown={closeInvite}>
          <div
            className="sheet"
            role="dialog"
            aria-labelledby="invite-title"
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closeInvite();
              }
            }}
          >
            <h2 id="invite-title">Invite to {title}</h2>
            <form onSubmit={(event) => void onInvite(event)}>
              <label>
                Handle
                <input
                  ref={inviteRef}
                  name="handle"
                  value={inviteHandle}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => setInviteHandle(event.target.value)}
                  required
                />
              </label>
              {inviteError ? (
                <p className="error" role="alert">
                  {inviteError}
                </p>
              ) : null}
              <div className="sheet-actions">
                <button type="button" className="btn-quiet" onClick={closeInvite}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={inviteBusy || !inviteHandle.trim()}>
                  {inviteBusy ? "Inviting…" : "Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
