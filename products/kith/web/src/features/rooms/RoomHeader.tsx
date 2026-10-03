import { Archive, ChevronLeft, UserPlus } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import type { RoomMember, RoomSummary } from "../../api/types";
import { useLocale, useT, type CopyKey } from "../../copy";
import type { SyncPhase } from "../../sync/types";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { displayName } from "../../ui/displayName";
import { IconButton } from "../../ui/IconButton";

function memberStack(members: RoomMember[], locale: string): RoomMember[] {
  const collator = new Intl.Collator(locale);
  const byName = (a: RoomMember, b: RoomMember): number => collator.compare(displayName(a), displayName(b));
  return [...members.filter((member) => member.kind === "human").sort(byName), ...members.filter((member) => member.kind === "agent").sort(byName)];
}

function statusOf(phase: SyncPhase): { statusKey: CopyKey | null; strip: CopyKey | null } {
  switch (phase) {
    case "loading_latest":
    case "connecting":
      return { statusKey: "room.status.connecting", strip: null };
    case "backoff":
    case "load_error":
      return { statusKey: null, strip: "room.status.reconnecting" };
    case "offline":
      return { statusKey: null, strip: "room.status.offline" };
    default:
      return { statusKey: null, strip: null };
  }
}

export function RoomHeader(props: {
  room: RoomSummary;
  phase: SyncPhase;
  archived: boolean;
  canUnarchive: boolean;
  onUnarchive: () => void;
  members: RoomMember[] | undefined;
  isOperator: boolean;
  onOpenMembers: () => void;
  onInvite: () => void;
}): ReactElement {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const stack = props.members ? memberStack(props.members, locale) : [];
  const { statusKey, strip } = statusOf(props.phase);
  return (
    <>
      <header data-testid="room-header" className="h-14 px-2 md:px-4 flex items-center gap-2 bg-surface border-b border-border">
        <span className="md:hidden">
          <IconButton data-testid="room-back" label={t("room.back")} icon={ChevronLeft} onClick={() => void navigate("/")} />
        </span>
        <h1 data-testid="room-title" className="min-w-0 truncate text-lg font-semibold text-ink">
          {props.room.name}
        </h1>
        {statusKey && (
          <span data-testid="room-connection" className="ml-2 text-sm text-ink-3">
            {t(statusKey)}
          </span>
        )}
        {props.members && (
          <button
            type="button"
            data-testid="room-members-open"
            aria-label={t("members.open", { n: props.members.length })}
            onClick={props.onOpenMembers}
            className="ml-auto flex h-10 items-center -space-x-1.5 rounded-md px-1 hover:bg-surface-2"
          >
            {stack.slice(0, 5).map((member) => (
              <span key={member.id} className="rounded-full ring-2 ring-surface">
                <Avatar size={24} id={member.id} name={displayName(member)} kind={member.kind} />
              </span>
            ))}
            {props.members.length > 5 && <span className="text-xs text-ink-2">+{props.members.length - 5}</span>}
          </button>
        )}
        {props.isOperator && <IconButton data-testid="room-invite" label={t("members.invite")} icon={UserPlus} onClick={props.onInvite} />}
      </header>
      {props.archived && (
        <div data-testid="room-archived-banner" role="status" className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-sm text-ink-2">
          <Archive size={16} aria-hidden />
          <span className="flex-1">{t("room.archived.banner")}</span>
          {props.canUnarchive && (
            <Button variant="ghost" data-testid="room-unarchive" onClick={props.onUnarchive}>
              {t("room.archived.unarchive")}
            </Button>
          )}
        </div>
      )}
      {strip && (
        <div data-testid="room-offline-strip" role="status" className="px-4 py-1 text-sm text-warn bg-surface-2 border-b border-border">
          {t(strip)}
        </div>
      )}
    </>
  );
}
