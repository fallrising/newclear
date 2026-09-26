import type { ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { cn, TitleSuffixContext, useDocumentTitle } from "@cms/ui";
import { copy } from "./copy";

export type SiteKey = "album" | "clinic" | "projects";

const SITES: Record<SiteKey, { scheme: string; name: string; basePath: string }> = {
  album: { scheme: "gallery-dark", name: copy["site.album"], basePath: "/album" },
  clinic: { scheme: "clinic-warm", name: copy["site.clinic"], basePath: "/clinic" },
  projects: { scheme: "projects-neutral", name: copy["site.projects"], basePath: "/projects" },
};

const NAV = [
  { to: "/album", label: copy["site.album"] },
  { to: "/clinic", label: copy["site.clinic"] },
  { to: "/projects", label: copy["site.projects"] },
];

/** Header + main + footer for one Front site, painted with that site's scheme (01 §5.3). */
export function SiteShell({ site }: { site: SiteKey }) {
  const def = SITES[site];
  return (
    <TitleSuffixContext.Provider value={def.name}>
      <div data-scheme={def.scheme} data-site={site} className="flex min-h-screen flex-col bg-page text-foreground text-front-body">
        <header className="border-b">
          <nav aria-label={copy["nav.label"]} className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-4 px-4 py-3">
            <Link to="/" className="font-semibold">
              {copy["site.cms"]}
            </Link>
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => cn("hover:underline", isActive && "font-semibold")}>
                {item.label}
              </NavLink>
            ))}
            <Link to="/login" className="ml-auto hover:underline">
              {copy["nav.login"]}
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8">
          <Outlet />
        </main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-[1200px] gap-2 px-4 py-4 text-subdued">
            <span>{copy["footer.name"]}</span>
            <span aria-hidden="true">·</span>
            <Link to="/" className="hover:underline">
              {copy["footer.selector"]}
            </Link>
          </div>
        </footer>
      </div>
    </TitleSuffixContext.Provider>
  );
}

/** Page heading for Front pages: display font, Front title size, and document.title (F-05). */
export function FrontTitle({ children, actions }: { children: string; actions?: ReactNode }) {
  useDocumentTitle(children);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 className="font-display text-front-title">{children}</h1>
      {actions}
    </div>
  );
}
