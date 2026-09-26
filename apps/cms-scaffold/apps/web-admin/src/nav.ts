import type { NavSection } from "@cms/ui";
import { copy } from "./copy";

/** Route patterns a login may return to (safeReturnTo). Keep in sync with routes.tsx. */
export const ADMIN_RETURN_ROUTES = ["/", "/types", "/users"] as const;

export const ADMIN_NAV: NavSection[] = [
  {
    items: [
      { label: copy["nav.home"], to: "/", end: true },
      { label: copy["nav.types"], to: "/types" },
      { label: copy["nav.users"], to: "/users" },
    ],
  },
];
