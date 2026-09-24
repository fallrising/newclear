import type { ReactElement } from "react";
import { Link } from "react-router";
import { useT } from "../../copy";

/** Same screen for "does not exist" and "not a member" (05 §3). */
export function RoomNotFound(): ReactElement {
  const t = useT();
  return (
    <section data-testid="room-not-found" className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold text-ink">{t("rooms.notFound.title")}</h2>
      <Link data-testid="room-not-found-back" to="/" className="text-md text-accent-strong underline">
        {t("rooms.notFound.back")}
      </Link>
    </section>
  );
}
