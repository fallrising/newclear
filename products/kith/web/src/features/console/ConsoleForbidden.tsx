import type { ReactElement } from "react";
import { Link } from "react-router";
import { useT } from "../../copy";

export function ConsoleForbidden(): ReactElement {
  const t = useT();
  return (
    <section data-testid="console-forbidden" className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("console.forbidden.title")}</h1>
      <Link data-testid="console-forbidden-back" to="/" className="text-md text-accent-strong underline">
        {t("console.forbidden.back")}
      </Link>
    </section>
  );
}
