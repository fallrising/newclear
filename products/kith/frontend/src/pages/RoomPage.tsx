import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { ApiError, inviteHuman, listMembers, listMessages } from "../api";
import { applyMention, filterMentionHandles, mentionQuery } from "../mention";
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
const REPLY_TTL_MS = 300_000;

type ActiveReply = { memberId: string; handle: string; at: number };

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

function isOperatorOnly(member: Member): boolean {
  return member.quota_class === "operator_personal" || member.operator_only === true;
}

function MemberBadges({ member, viewerIsOperator }: { member: Member; viewerIsOperator: boolean }) {
  const showOperatorOnly = !viewerIsOperator && isOperatorOnly(member);
  return (
    <>
      {member.kind === "agent" ? <span className="badge">agent</span> : null}
      {showOperatorOnly ? <span className="badge badge-operator">operator-only</span> : null}
    </>
  );
}

function limitSentence(member: Member, viewerIsOperator: boolean): string | null {
  if (member.reply_limit?.code === "fixed") {
    return `Fixed reply only: ${member.reply_limit.fixed_text}`;
  }
  if (!viewerIsOperator && isOperatorOnly(member)) {
    return null;
  }
  if (member.reply_limit?.code === "sidecar_off") {
    return "Not enabled · Requires the operator’s computer";
  }
  return null;
}

function memberAccessibleName(member: Member, viewerIsOperator: boolean): string {
  const name = member.display_name || member.handle || member.id;
  const handle = member.handle ? `@${member.handle}` : "";
  const kind = member.kind === "agent" ? "agent" : "human";
  const limit = limitSentence(member, viewerIsOperator);
  return [name, handle, kind, limit].filter(Boolean).join(", ");
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
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [replies, setReplies] = useState<ActiveReply[]>([]);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
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
  const membersRef = useRef(members);
  const repliesRef = useRef(replies);
  const hadMembers = useRef(false);
  const eventSeenAt = useRef(new Map<string, number>());
  const pendingCaret = useRef<number | null>(null);
  membersRef.current = members;
  repliesRef.current = replies;
  const connected = link === "live";

  function commitEvents() {
    setEvents([...eventsRef.current.values()].sort((a, b) => a.seq - b.seq));
  }

  function mergeEvents(incoming: TimelineEvent[]): number {
    let added = 0;
    for (const event of incoming) {
      if (!eventsRef.current.has(event.seq)) {
        eventsRef.current.set(event.seq, event);
        if (event.sender_id) {
          eventSeenAt.current.set(event.sender_id, Date.now());
          clearReply(event.sender_id, false);
        }
        added += 1;
      }
    }
    if (added > 0) {
      commitEvents();
    }
    return added;
  }

  function clearReply(memberId: string, announce: boolean) {
    const current = repliesRef.current.find((item) => item.memberId === memberId);
    setReplies((items) => items.filter((item) => item.memberId !== memberId));
    if (announce && current) {
      const seen = eventSeenAt.current.get(memberId) ?? 0;
      if (seen < current.at) {
        setReplyNotice(`${current.handle} reply ended`);
      }
    }
  }

  function noteStatus(memberId: string, statusBody: string) {
    if (statusBody === "is replying" || statusBody === "reply ended") {
      if (statusBody === "reply ended") {
        clearReply(memberId, true);
        return;
      }
      const handle = membersRef.current.get(memberId)?.handle;
      if (!handle) {
        return;
      }
      const next = { memberId, handle, at: Date.now() };
      setReplies((items) => [...items.filter((item) => item.memberId !== memberId), next]);
      setReplyNotice(null);
      return;
    }
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
    setMembers(new Map());
    setMembersLoading(true);
    setMembersError(null);
    setRefreshError(null);
    setReplies([]);
    setReplyNotice(null);
    hadMembers.current = false;
    eventSeenAt.current = new Map();
    setCaret(0);
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

    void (async () => {
      try {
        const list = await listMembers(room.id, ac.signal);
        if (cancelled) {
          return;
        }
        setMembers(new Map(list.map((member) => [member.id, member])));
        hadMembers.current = true;
        setMembersError(null);
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        if (err instanceof ApiError && err.status === 401) {
          onLoggedOut();
          return;
        }
        if (!hadMembers.current) {
          setMembers(new Map());
        }
        setMembersError("Could not load members.");
      } finally {
        if (!cancelled) {
          setMembersLoading(false);
        }
      }
    })();

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
          setReplies([]);
          setReplyNotice(null);
        }
      };
      ws.onclose = () => {
        if (cancelled) {
          return;
        }
        setLink("offline");
        setReplies([]);
        setReplyNotice(null);
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

  const activeMention = mentionQuery(body, caret);
  const mentionOptions =
    activeMention && !membersLoading && !membersError && link !== "offline"
      ? filterMentionHandles([...members.values()], activeMention.query)
      : [];
  const mentionOpen = !mentionDismissed && mentionOptions.length > 0;
  const activeMentionId = mentionOpen ? `mention-opt-${mentionIndex}` : undefined;

  function chooseMention(index: number) {
    const option = mentionOptions[index];
    if (!option?.handle || !activeMention) {
      return;
    }
    const next = applyMention(body, activeMention.start, caret, option.handle);
    pendingCaret.current = next.caret;
    setBody(next.value);
    setCaret(next.caret);
    setMentionDismissed(false);
    setMentionIndex(0);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229;
    if (mentionOpen && !composing) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => Math.min(mentionOptions.length - 1, index + 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => Math.max(0, index - 1));
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionDismissed(true);
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        setMentionDismissed(true);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        chooseMention(mentionIndex);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault();
      submitBody();
    }
  }

  const title = room.name ?? room.slug ?? room.id;
  const replyLine = replies.reduce<ActiveReply | null>(
    (latest, item) => (!latest || item.at >= latest.at ? item : latest),
    null,
  );

  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Kith`;
    return () => {
      document.title = previous;
    };
  }, [title]);
  const linkLabel = link === "live" ? "live" : link === "connecting" ? "connecting" : "offline";

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

  useEffect(() => {
    if (pendingCaret.current == null || !composerRef.current) {
      return;
    }
    const pos = pendingCaret.current;
    composerRef.current.setSelectionRange(pos, pos);
    pendingCaret.current = null;
  }, [body]);

  useEffect(() => {
    setMentionIndex(0);
  }, [activeMention?.query, activeMention?.start]);

  useEffect(() => {
    if (!mentionOpen) {
      return;
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (composerRef.current?.contains(target) || document.getElementById("mention-list")?.contains(target)) {
        return;
      }
      setMentionDismissed(true);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [mentionOpen]);

  useEffect(() => {
    if (replies.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const now = Date.now();
      setReplies((items) => items.filter((item) => now - item.at < REPLY_TTL_MS));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [replies.length]);

  async function reloadMembers() {
    setMembersLoading(members.size === 0);
    try {
      const list = await listMembers(room.id);
      setMembers(new Map(list.map((member) => [member.id, member])));
      hadMembers.current = true;
      setMembersError(null);
      setRefreshError(null);
      return list;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onLoggedOut();
        return null;
      }
      if (!hadMembers.current) {
        setMembers(new Map());
      }
      setMembersError("Could not load members.");
      return null;
    } finally {
      setMembersLoading(false);
    }
  }

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
      const memberId = await inviteHuman(room.id, handle);
      setInviteOpen(false);
      setInviteHandle("");
      let list: Member[] | null = null;
      try {
        list = await listMembers(room.id);
      } catch {
        list = null;
      }
      if (!list) {
        setRefreshError("Invitation succeeded. Couldn't refresh members.");
        return;
      }
      setMembers(new Map(list.map((member) => [member.id, member])));
      hadMembers.current = true;
      setMembersError(null);
      const added = list.find((member) => member.id === memberId);
      if (!added) {
        setRefreshError("Invitation succeeded. Couldn't refresh members.");
        return;
      }
      setRefreshError(null);
      setNotice(added.kind === "agent" ? null : "They will see this room after they refresh.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_member") {
        setInviteOpen(false);
        setInviteHandle("");
        await reloadMembers();
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setInviteError("No such handle.");
      } else if (err instanceof ApiError && err.code === "room_full") {
        setInviteError("This room is full.");
      } else if (err instanceof ApiError && err.status === 403) {
        setInviteError(err.message || "operator required");
      } else {
        setInviteError(err instanceof Error ? err.message : "Could not invite");
      }
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
        <div
          className="member-strip"
          role="list"
          aria-label="Members"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.currentTarget.scrollBy({ left: 80 });
            }
            if (event.key === "ArrowLeft") {
              event.currentTarget.scrollBy({ left: -80 });
            }
          }}
        >
          {membersLoading && members.size === 0 ? <p className="muted">Loading members…</p> : null}
          {[...members.values()].map((member) => {
            const limit = limitSentence(member, operator);
            return (
              <span key={member.id} className={member.kind === "agent" ? "member-chip agent" : "member-chip"} role="listitem">
                <span className="member-name">{member.display_name || member.handle || member.id}</span>
                {member.handle ? <span className="member-handle">@{member.handle}</span> : null}
                <MemberBadges member={member} viewerIsOperator={operator} />
                {limit ? <span className="member-limit">{limit}</span> : null}
                <span className="sr-only">{memberAccessibleName(member, operator)}</span>
              </span>
            );
          })}
        </div>
        {operator ? (
          <button type="button" className="btn-quiet" onClick={() => setInviteOpen(true)}>
            Invite
          </button>
        ) : null}
      </div>
      {membersError ? (
        <p className="error" role="alert">
          {membersError}{" "}
          <button type="button" onClick={() => void reloadMembers()}>
            Retry
          </button>
        </p>
      ) : null}
      {refreshError ? (
        <p className="error" role="alert">
          {refreshError}{" "}
          <button type="button" onClick={() => void reloadMembers()}>
            Retry
          </button>
        </p>
      ) : null}
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
                  {member ? <MemberBadges member={member} viewerIsOperator={operator} /> : null}
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
        {replyLine ? (
          <p className="status-line" role="status">
            {replyLine.handle} is replying
          </p>
        ) : (
          Object.entries(typing).map(([memberId, statusBody]) => (
            <p key={memberId} className="status-line">
              {memberLabel(memberId, members)} {statusBody}
            </p>
          ))
        )}
        {replyNotice ? (
          <p className="sr-only" role="status">
            {replyNotice}
          </p>
        ) : null}
      </div>
      {link === "offline" ? <p className="conn-banner">Offline. Reconnecting…</p> : null}
      <form className="composer" onSubmit={onSubmit}>
        {mentionOpen ? (
          <ul id="mention-list" className="mention-list" role="listbox">
            {mentionOptions.map((member, index) => (
              <li key={member.id} id={`mention-opt-${index}`} role="option" aria-selected={index === mentionIndex}>
                <button
                  type="button"
                  className={index === mentionIndex ? "mention-opt active" : "mention-opt"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseMention(index)}
                >
                  <span>{member.display_name || member.handle}</span>
                  {member.handle ? <span>@{member.handle}</span> : null}
                  <MemberBadges member={member} viewerIsOperator={operator} />
                  {limitSentence(member, operator) ? <span>{limitSentence(member, operator)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p id="composer-hint" className="composer-hint">
          <span className="enter-hint">Enter to send · Shift+Enter for a new line</span>
          <span>Type @ to mention a room member.</span>
        </p>
        <div className="composer-row">
          <textarea
            ref={composerRef}
            name="body"
            rows={1}
            maxLength={8192}
            value={body}
            role="combobox"
            aria-expanded={mentionOpen}
            aria-controls="mention-list"
            aria-activedescendant={activeMentionId}
            onChange={(event) => {
              setBody(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
              setMentionDismissed(false);
            }}
            onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            aria-label={`Message ${title}`}
            aria-describedby="composer-hint"
            aria-autocomplete="list"
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
                  autoComplete="off"
                  onChange={(event) => setInviteHandle(event.target.value)}
                  required
                />
              </label>
              <p className="muted">Enter the handle of an existing person or agent.</p>
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
