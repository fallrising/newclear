import { useLocation } from "react-router";
import { SiteShell } from "./shell";
import type { SiteKey } from "./sites";

export function RootRoute() {
  const { pathname } = useLocation();
  // The three existing site layouts match only their respective site paths.
  const site = pathname.split("/")[1] as SiteKey;
  return <SiteShell site={site} />;
}
