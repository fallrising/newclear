import { createContext, useContext, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";
import { Button, cn, Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, TitleSuffixContext, useDocumentTitle } from "@cms/ui";
import { useMemberSession } from "./member-auth";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, Skeleton } from "@cms/ui";
import { copy } from "./copy";
import { SITES, type SiteDefinition, type SiteKey } from "./sites";

const SiteContext = createContext<SiteDefinition | null>(null);

/** The site the page is rendered in; null outside SiteShell (selector, login, unknown top-level paths). */
export function useSite(): SiteDefinition | null {
  return useContext(SiteContext);
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2"
    >
      {copy["skipLink"]}
    </a>
  );
}

function NavLinks({ site, onNavigate, vertical }: { site: SiteDefinition; onNavigate?: () => void; vertical: boolean }) {
  return (
    <ul className={cn("flex gap-6", vertical && "flex-col gap-4")}>
      {site.nav.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => cn("hover:underline", isActive && "font-semibold underline underline-offset-4")}
          >
            {copy[item.label]}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

export function MemberMenu({ displayName }: { displayName: string }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="max-w-40 truncate" data-testid="member-menu">
        {displayName}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent data-scheme="clinic-warm" aria-label={copy["member.menu.label"]} className="bg-page text-foreground">
      <DropdownMenuItem asChild>
        <Link to="/clinic/me">
          {copy["member.menu.home"]}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/clinic/appointments/new">
          {copy["member.menu.new"]}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/logout">
          {copy["member.menu.logout"]}
        </Link>
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
function ClinicAccount() {
  const auth = useMemberSession();
  if (auth.isPending) return <Skeleton aria-hidden className="h-9 w-20" />;
  if (auth.isError) return null;
  return auth.data ? <MemberMenu displayName={auth.data.principal.displayName} /> : <Link data-testid="member-login" to="/login?next=/clinic/me" className="underline">
    {copy["member.login"]}
  </Link>;
}

/** SiteHeader (01 §2.2): brand + navigation; below 768px the navigation moves into a Sheet (surface-front §6.1). */
function SiteHeader({ site }: { site: SiteDefinition }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-4 px-4 py-4">
        <Link to={site.basePath} className="font-display text-front-heading" data-testid="site-brand">
          {site.name}
        </Link>
        <nav aria-label={copy["nav.label"]} className="hidden md:block" data-testid="site-nav">
          <NavLinks site={site} vertical={false} />
        </nav>
        {site.key === "clinic" ? <ClinicAccount /> : null}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" className="md:hidden" aria-label={copy["nav.open"]} data-testid="site-nav-open">
              {copy["nav.menu"]}
            </Button>
          </SheetTrigger>
          {/* The sheet is portalled out of the site root, so it repeats the scheme. No text-front-body here:
              tailwind-merge (cn) would read it as a colour and drop text-foreground (W3 §2.3). */}
          <SheetContent side="right" data-scheme={site.scheme} aria-describedby={undefined} className="bg-page text-foreground">
            <SheetHeader>
              <SheetTitle>{site.name}</SheetTitle>
            </SheetHeader>
            <nav aria-label={copy["nav.label"]} className="px-4 text-front-body" data-testid="site-nav-sheet">
              <NavLinks site={site} vertical onNavigate={() => setOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-[1200px] flex-wrap gap-2 px-4 py-6 text-subdued">
        <span>{copy["footer.name"]}</span>
        <span aria-hidden="true">·</span>
        <Link to="/" className="hover:underline">
          {copy["footer.selector"]}
        </Link>
      </div>
    </footer>
  );
}

/** Header + main + footer for one Front site, painted with that site's scheme (01 §5.3, surface-front §4.3). */
export function SiteShell({ site }: { site: SiteKey }) {
  const def = SITES[site];
  return (
    <SiteContext.Provider value={def}>
      <TitleSuffixContext.Provider value={def.name}>
        <div data-scheme={def.scheme} data-site={site} className="flex min-h-screen flex-col bg-page text-foreground text-front-body">
          <SkipLink />
          <SiteHeader site={def} />
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 outline-none">
            <Outlet />
          </main>
          <SiteFooter />
        </div>
      </TitleSuffixContext.Provider>
    </SiteContext.Provider>
  );
}

export interface FrontTitleProps {
  children: string;
  actions?: ReactNode;
  /** document.title before the site suffix; defaults to the heading. null: the suffix alone (site homes). */
  documentTitle?: string | null;
}

/** Page heading for Front pages: display font, Front title size, and document.title (F-05). */
export function FrontTitle({ children, actions, documentTitle }: FrontTitleProps) {
  useDocumentTitle(documentTitle === undefined ? children : documentTitle);
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <h1 className="font-display text-front-title">{children}</h1>
      {actions}
    </div>
  );
}
