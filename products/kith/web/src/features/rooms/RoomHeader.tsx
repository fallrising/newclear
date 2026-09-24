import { ChevronLeft } from "lucide-react";
import type { ReactElement } from "react";
import { useNavigate } from "react-router";
import type { Room } from "../../api/types";
import { useT, type CopyKey } from "../../copy";
import type { SyncPhase } from "../../sync/types";
import { IconButton } from "../../ui/IconButton";

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

export function RoomHeader(props: { room: Room; phase: SyncPhase }): ReactElement {
  const t = useT();
  const navigate = useNavigate();
  const { statusKey, strip } = statusOf(props.phase);
  return (
    <>
      <header data-testid="room-header" className="h-14 px-2 md:px-4 flex items-center gap-2 bg-surface border-b border-border">
        <span className="md:hidden">
          <IconButton data-testid="room-back" label={t("room.back")} icon={ChevronLeft} onClick={() => void navigate("/")} />
        </span>
        <h1 data-testid="room-title" className="text-lg font-semibold text-ink truncate">
          {props.room.name}
        </h1>
        {statusKey && (
          <span data-testid="room-connection" className="ml-2 text-sm text-ink-3">
            {t(statusKey)}
          </span>
        )}
      </header>
      {strip && (
        <div data-testid="room-offline-strip" role="status" className="px-4 py-1 text-sm text-warn bg-surface-2 border-b border-border">
          {t(strip)}
        </div>
      )}
    </>
  );
}
