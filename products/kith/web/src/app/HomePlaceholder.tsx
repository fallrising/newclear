import type { ReactElement } from "react";
import type { Me } from "../api/types";
import { useT } from "../copy";
import { displayName } from "../ui/displayName";

/** W0 empty home; W2 replaces it with the room list. */
export function HomePlaceholder(props: { me: Me }): ReactElement {
  const t = useT();
  return (
    <section data-testid="home-empty" className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 data-testid="home-greeting" className="text-2xl font-semibold text-ink">
        {t("home.greeting", { name: displayName(props.me) })}
      </h1>
      <p className="text-md text-ink-2 max-w-login">{t("home.placeholder.body")}</p>
    </section>
  );
}
