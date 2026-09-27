import { useEffect, useState, type ReactElement } from "react";
import { ApiError } from "../../api/client";
import { useUpdateAttention } from "../../api/rooms";
import type { AttentionMode, AttentionUpdate, RoomMember } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import { Button } from "../../ui/Button";
import { Dialog } from "../../ui/Dialog";
import { displayName } from "../../ui/displayName";

const MODES: AttentionMode[] = ["silent", "mention", "keyword", "ambient"];

function keywordText(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed.join(", ");
  } catch {
    // Keywords that are not a JSON array start blank.
  }
  return "";
}

export function AttentionDialog(props: {
  roomId: string;
  member: RoomMember | null;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const t = useT();
  const update = useUpdateAttention();
  const member = props.member;
  const [mode, setMode] = useState<AttentionMode>(member?.attention_mode ?? "mention");
  const [keywords, setKeywords] = useState("");
  const [cooldown, setCooldown] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    setMode(member.attention_mode);
    setKeywords(keywordText(member.keywords_json));
    setCooldown("");
    setError(null);
  }, [member]);

  const submit = (): void => {
    if (!member) return;
    const body: AttentionUpdate = { mode };
    if (mode === "keyword") {
      body.keywords = keywords
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
    const raw = cooldown.trim();
    if (raw !== "") {
      if (!/^\d+$/.test(raw) || Number(raw) > 3600) {
        setError(t("error.code.invalid_request"));
        return;
      }
      body.cooldown_ms = Number(raw) * 1000;
    }
    setError(null);
    update.mutate(
      { roomId: props.roomId, memberId: member.id, update: body },
      {
        onSuccess: () => props.onOpenChange(false),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 400) setError(t("error.code.invalid_request"));
          else setError(t("error.code.unknown"));
        },
      },
    );
  };

  return (
    <Dialog
      open={member !== null}
      onOpenChange={props.onOpenChange}
      title={member ? t("members.attentionTitle", { name: displayName(member) }) : t("members.attention")}
    >
      <fieldset className="flex flex-col gap-3">
        {MODES.map((item) => (
          <label key={item} className="flex flex-col gap-0.5 text-sm">
            <span className="flex items-center gap-2 text-ink">
              <input
                type="radio"
                name="attention-mode"
                data-testid={"attention-mode-" + item}
                checked={mode === item}
                onChange={() => setMode(item)}
              />
              {t(("members.attentionMode." + item) as CopyKey)}
            </span>
            <span className="pl-6 text-ink-3">{t(("members.attentionHelp." + item) as CopyKey)}</span>
          </label>
        ))}
      </fieldset>
      {mode === "keyword" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-ink-2">{t("members.attentionKeywords")}</span>
          <input
            data-testid="attention-keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            className="h-10 rounded-md border border-border-strong bg-surface px-3 text-ink"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink-2">{t("members.attentionCooldown")}</span>
        <input
          data-testid="attention-cooldown"
          inputMode="numeric"
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
          className="h-10 rounded-md border border-border-strong bg-surface px-3 text-ink"
        />
      </label>
      {error && (
        <p data-testid="attention-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" data-testid="attention-cancel" onClick={() => props.onOpenChange(false)}>
          {t("members.cancel")}
        </Button>
        <Button variant="primary" data-testid="attention-submit" disabled={update.isPending} onClick={submit}>
          {t("members.attentionSubmit")}
        </Button>
      </div>
    </Dialog>
  );
}
