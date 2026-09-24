import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { useT } from "../../copy";
import type { SyncPhase } from "../../sync/types";
import { Button } from "../../ui/Button";
import { loadDraft, saveDraft } from "./draftStorage";

const MAX_BYTES = 8192;

type Props = { roomId: string; roomName: string; phase: SyncPhase; onSend(body: string): void };

export function Composer(props: Props): ReactElement {
  const t = useT();
  const [value, setValue] = useState(() => loadDraft(props.roomId));
  const [coarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const ref = useRef<HTMLTextAreaElement>(null);

  const bytes = new TextEncoder().encode(value).length;
  const tooLong = bytes > MAX_BYTES;
  const offline = props.phase === "offline";
  const canSend = value.trim().length > 0 && !tooLong && !offline && props.phase !== "auth_lost" && props.phase !== "not_found";

  // Save the draft 300 ms after the last change.
  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(props.roomId, value), 300);
    return () => window.clearTimeout(id);
  }, [props.roomId, value]);

  // Grow with the content up to 40% of the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4)) + "px";
  }, [value]);

  const submit = (): void => {
    if (!canSend) return;
    props.onSend(value); // sent as typed; the server does not trim either
    setValue("");
    saveDraft(props.roomId, "");
    ref.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing || e.keyCode === 229) return; // IME composition
    if (e.shiftKey || coarse) return; // newline
    e.preventDefault();
    submit();
  };

  return (
    <form
      data-testid="composer"
      className="border-t border-border bg-surface px-3 pt-2 pb-safe"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
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
          aria-label={t("composer.label")}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("composer.placeholder", { room: props.roomName })}
          className="flex-1 resize-none rounded-md border border-border-strong bg-surface px-3 py-2 text-ink text-md-touch md:text-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <Button variant="primary" type="submit" data-testid="composer-send" disabled={!canSend}>
          {t("composer.send")}
        </Button>
      </div>
    </form>
  );
}
