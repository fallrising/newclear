import { useState, type ReactNode } from "react";
import { NavLink } from "react-router";
import { MenuIcon, UserIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "../components/ui/sheet";
import { cn } from "../lib/utils";
import { uiCopy } from "../copy";
import { TitleSuffixContext } from "./document-title";

export interface NavItem {
  label: string;
  to: string;
  /** Match only the exact path (use for "/"). */
  end?: boolean;
  testId?: string;
}

export interface NavSection {
  /** Group heading, for example "內容". Omit for an ungrouped section. */
  label?: string;
  items: NavItem[];
}

export interface AppFrameProps {
  product: "back" | "admin";
  /** Shown in the top bar and appended to document.title. */
  productName: string;
  nav: NavSection[];
  account: { displayName: string; detail: string };
  onSignOut: () => void;
  children: ReactNode;
}

function Nav({ nav, onNavigate }: { nav: NavSection[]; onNavigate?: () => void }) {
  return (
    <nav aria-label={uiCopy["ui.nav.label"]} className="flex flex-col gap-4 p-3">
      {nav.map((section, index) => (
        <div key={section.label ?? index} className="flex flex-col gap-1">
          {section.label ? <p className="px-2 text-table font-semibold text-subdued">{section.label}</p> : null}
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              data-testid={item.testId}
              className={({ isActive }) =>
                cn("rounded-md px-2 py-1.5 hover:bg-accent", isActive && "bg-accent font-semibold")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Top bar + side navigation + main area (01 §6.2). Below 1024px the side navigation moves into a Sheet. */
export function AppFrame({ product, productName, nav, account, onSignOut, children }: AppFrameProps) {
  const [open, setOpen] = useState(false);
  return (
    <TitleSuffixContext.Provider value={productName}>
      <div className="min-h-screen bg-page" data-product={product}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
          {uiCopy["ui.skipLink"]}
        </a>
        <header className="sticky top-0 z-40 border-b bg-surface">
          <div className="flex h-14 items-center gap-2 px-4 lg:px-6">
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden" aria-label={uiCopy["ui.nav.open"]} data-testid="nav-open">
                  <MenuIcon aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader>
                  <SheetTitle>{productName}</SheetTitle>
                </SheetHeader>
                <Nav nav={nav} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="text-card-title" data-testid="product-name">
              {productName}
            </span>
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" aria-label={uiCopy["ui.account.menu"]} data-testid="account-menu">
                    <UserIcon aria-hidden="true" />
                    <span className="hidden sm:inline">{account.displayName}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    <p>{account.displayName}</p>
                    <p className="font-normal text-subdued">{account.detail}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onSignOut} data-testid="sign-out">
                    {uiCopy["ui.account.signOut"]}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {product === "admin" ? <div className="h-1 bg-admin-accent" data-testid="admin-accent" aria-hidden="true" /> : null}
        </header>
        <div className="flex">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r bg-surface lg:block">
            <Nav nav={nav} />
          </aside>
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 lg:px-6">
            <div className="mx-auto max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
    </TitleSuffixContext.Provider>
  );
}
