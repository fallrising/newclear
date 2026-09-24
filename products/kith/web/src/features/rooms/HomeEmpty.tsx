import { Hash, UserPlus } from "lucide-react";
import type { ReactElement } from "react";
import { Link } from "react-router";
import type { Me } from "../../api/types";
import { useT } from "../../copy";
import { displayName } from "../../ui/displayName";

const CARD =
  "flex w-full max-w-login items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left hover:bg-surface-2";

export function HomeEmpty(props: { me: Me; roomCount: number; onCreateRoom: () => void }): ReactElement {
  const t = useT();
  if (props.me.is_operator === 1) {
    return (
      <section data-testid="home-empty" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 data-testid="home-greeting" className="text-2xl font-semibold text-ink">
          {props.roomCount === 0
            ? t("home.firstRun.title")
            : t("home.greeting", { name: displayName(props.me) })}
        </h1>
        <button type="button" data-testid="home-guide-room" className={CARD} onClick={props.onCreateRoom}>
          <Hash size={20} className="text-accent" />
          <div>
            <p className="text-md font-medium text-ink">{t("home.guide.room.title")}</p>
            <p className="text-sm text-ink-2">{t("home.guide.room.body")}</p>
          </div>
        </button>
        <Link data-testid="home-guide-people" to="/console/people" className={CARD}>
          <UserPlus size={20} className="text-accent" />
          <div>
            <p className="text-md font-medium text-ink">{t("home.guide.people.title")}</p>
            <p className="text-sm text-ink-2">{t("home.guide.people.body")}</p>
          </div>
        </Link>
      </section>
    );
  }
  if (props.roomCount === 0) {
    return (
      <section data-testid="home-empty" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p data-testid="home-no-rooms" className="text-md text-ink-2">
          {t("home.noRooms", { operator: props.me.operator_display_name ?? "operator" })}
        </p>
      </section>
    );
  }
  return (
    <section data-testid="home-empty" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 data-testid="home-greeting" className="text-2xl font-semibold text-ink">
        {t("home.greeting", { name: displayName(props.me) })}
      </h1>
      <p className="text-md text-ink-2 max-w-login">{t("rooms.home.body")}</p>
    </section>
  );
}
