import { useT } from "../copy";

export function RouteLoading() {
  const t = useT();
  return (
    <div data-testid="route-loading" aria-busy="true" className="p-6">
      <span className="sr-only">{t("app.loading")}</span>
    </div>
  );
}
