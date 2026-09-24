import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { RoomMember } from "../../api/types";
import { useT } from "../../copy";
import type { SyncPhase } from "../../sync/types";
import { Button } from "../../ui/Button";
import { loadDraft, saveDraft } from "./draftStorage";
import { MentionPicker } from "./MentionPicker";
import { mentionQueryAt, type MentionQuery } from "./mentionQuery";

const MAX_BYTES = 8192;
const TYPING_GAP_MS = 3000;

type Props = {
  roomId: string;
  roomName: string;
  phase: SyncPhase;
  archived: boolean;
  members: RoomMember[] | undefined;
  viewerIsOperator: boolean;
  onSend: (body: string) => void;
  onTyping: () => void;
};

function byHandle(a: RoomMember, b: RoomMember): number {
  return a.handle.localeCompare(b.handle, "en", { sensitivity: "base" });
}

export function Composer(props: Props): ReactElement {
  const t = useT();
  const listId = useId();
  const [value, setValue] = useState(() => loadDraft(props.roomId));
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [coarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastTypingAt = useRef(0);

  const bytes = new TextEncoder().encode(value).length;
  const tooLong = bytes > MAX_BYTES;
  const offline = props.phase === "offline";
  const canSend =
    !props.archived && value.trim().length > 0 && !tooLong && !offline && props.phase !== "auth_lost" && props.phase !== "not_found";

  const query: MentionQuery | null = mentionQueryAt(value, caret);
  const options =
    query && props.members
      ? props.members.filter((member) => member.handle.toLowerCase().startsWith(query.prefix.toLowerCase())).sort(byHandle)
      : [];
  const open =
    query !== null &&
    options.length > 0 &&
    query.start !== dismissedAt &&
    !suspended &&
    props.phase !== "offline" &&
    props.members !== undefined;
  const active = options.length === 0 ? 0 : Math.min(activeIndex, options.length - 1);
  const queryIdentity = query ? query.start + ":" + query.prefix : "";
  const seenIdentity = useRef(queryIdentity);
  if (seenIdentity.current !== queryIdentity) {
    seenIdentity.current = queryIdentity;
    if (activeIndex !== 0) setActiveIndex(0);
  }

  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(props.roomId, value), 300);
    return () => window.clearTimeout(id);
  }, [props.roomId, value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4)) + "px";
  }, [value]);

  const syncCaret = (el: HTMLTextAreaElement): void => setCaret(el.selectionStart ?? value.length);

  const noteTyping = (next: string): void => {
    if (next.trim() === "") return;
    const now = Date.now();
    if (now - lastTypingAt.current < TYPING_GAP_MS) return;
    lastTypingAt.current = now;
    props.onTyping();
  };

  const submit = (): void => {
    if (!canSend) return;
    props.onSend(value);
    setValue("");
    setCaret(0);
    saveDraft(props.roomId, "");
    ref.current?.focus();
  };

  const pick = (member: RoomMember): void => {
    if (!query) return;
    const insert = "@" + member.handle + " ";
    const next = value.slice(0, query.start) + insert + value.slice(query.end);
    const pos = query.start + insert.length;
    setValue(next);
    setCaret(pos);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (open && query) {
      if (composing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const count = options.length;
        if (count === 0) return;
        setActiveIndex((i) => {
          const current = Math.min(i, count - 1);
          return e.key === "ArrowDown" ? (current + 1) % count : (current - 1 + count) % count;
        });
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const member = options[active];
        if (member) pick(member);
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        setDismissedAt(query.start);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(query.start);
        return;
      }
    }
    if (e.key !== "Enter") return;
    if (composing) return;
    if (e.shiftKey || coarse) return;
    e.preventDefault();
    submit();
  };

  return (
    <form
      data-testid="composer"
      className="relative border-t border-border bg-surface px-3 pt-2 pb-safe"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {open && query && (
        <MentionPicker id={listId} options={options} activeIndex={active} viewerIsOperator={props.viewerIsOperator} onPick={pick} />
      )}
      {props.archived && (
        <p data-testid="composer-archived" role="status" className="pb-1 text-sm text-ink-2">
          {t("composer.archived")}
        </p>
      )}
      {offline && (
        <p data-testid="composer-offline" role="status" className="pb-1 text-sm text-warn">
          {t("composer.offline")}
        </p>
      )}
      {tooLong && (
        <p data-testid="composer-too-long" role="alert" className="pb-1 text-sm text-danger">
          {t("composer.tooLong")}
        </p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          data-testid="composer-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? listId + "-" + active : undefined}
          aria-label={t("composer.label")}
          rows={1}
          value={value}
          disabled={props.archived}
          onChange={(e) => {
            setValue(e.target.value);
            syncCaret(e.target);
            setSuspended(false);
            noteTyping(e.target.value);
          }}
          onSelect={(e) => syncCaret(e.currentTarget)}
          onKeyUp={(e) => syncCaret(e.currentTarget)}
          onClick={(e) => syncCaret(e.currentTarget)}
          onBlur={() => setSuspended(true)}
          onKeyDown={onKeyDown}
          placeholder={props.archived ? t("composer.archivedPlaceholder") : t("composer.placeholder", { room: props.roomName })}
          className="flex-1 resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink text-md-touch md:text-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <Button variant="primary" type="submit" data-testid="composer-send" disabled={!canSend}>
          {t("composer.send")}
        </Button>
      </div>
    </form>
  );
}
