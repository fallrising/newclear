import type { RefObject } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@cms/ui";
import { copy } from "./copy";
import { NavLinks } from "./shell";
import type { SiteDefinition } from "./sites";

export function MobileNav({ site, open, onOpenChange, triggerRef }: {
  site: SiteDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    {/* The portal repeats the site's scheme. text-front-body belongs on the nav so cn keeps text-foreground. */}
    <SheetContent id="site-nav-dialog" side="right" data-scheme={site.scheme} aria-describedby={undefined}
      className="bg-page text-foreground" onCloseAutoFocus={(event) => {
        event.preventDefault();
        triggerRef.current?.focus();
      }}>
      <SheetHeader>
        <SheetTitle>{site.name}</SheetTitle>
      </SheetHeader>
      <nav aria-label={copy["nav.label"]} className="px-4 text-front-body" data-testid="site-nav-sheet">
        <NavLinks site={site} vertical onNavigate={() => onOpenChange(false)} />
      </nav>
    </SheetContent>
  </Sheet>;
}
