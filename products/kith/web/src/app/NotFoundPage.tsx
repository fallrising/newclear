import type { ReactElement } from "react";
import { Link } from "react-router";
import { useT } from "../copy";

export function NotFoundPage(): ReactElement {
  const t = useT();
  return (
    <section data-testid="not-found" className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold text-ink">{t("notFound.title")}</h1>
      <Link data-testid="not-found-home" to="/" className="text-md text-accent-strong underline">
        {t("notFound.home")}
      </Link>
    </section>
  );
}
