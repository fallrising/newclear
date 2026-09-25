import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router";
import { useT } from "../../copy";

export function ConsoleLayout(props: { active: "agents" | "providers" | "people" | "rooms"; children: ReactNode }): ReactElement {
  const t = useT();
  const item = (active: boolean): string =>
    "h-10 rounded-md px-3 inline-flex items-center " + (active ? "bg-accent-tint text-accent-strong font-medium" : "text-ink-2");
  return (
    <div data-testid="console" className="flex flex-1 min-h-0 flex-col md:flex-row">
      <nav aria-label={t("console.nav.label")} className="flex gap-1 border-b border-border px-2 py-2 md:w-52 md:flex-col md:border-b-0 md:border-r">
        <Link data-testid="console-nav-agents" to="/console/agents" aria-current={props.active === "agents" ? "page" : undefined} className={item(props.active === "agents")}>
          {t("console.nav.agents")}
        </Link>
        <Link data-testid="console-nav-providers" to="/console/providers" aria-current={props.active === "providers" ? "page" : undefined} className={item(props.active === "providers")}>
          {t("console.nav.providers")}
        </Link>
        <Link data-testid="console-nav-people" to="/console/people" aria-current={props.active === "people" ? "page" : undefined} className={item(props.active === "people")}>
          {t("console.nav.people")}
        </Link>
        <Link data-testid="console-nav-rooms" to="/console/rooms" aria-current={props.active === "rooms" ? "page" : undefined} className={item(props.active === "rooms")}>
          {t("console.nav.rooms")}
        </Link>
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto px-4 py-6 md:px-8">{props.children}</div>
    </div>
  );
}
