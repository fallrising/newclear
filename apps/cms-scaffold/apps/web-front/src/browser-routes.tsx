import { lazy, Suspense } from "react";
import { matchRoutes, useLocation, useRoutes, type RouteObject } from "react-router";
import { DefaultSkeleton } from "@cms/ui";
import { routes } from "./routes";

/** Stable module promises are shared by matched loading and React.lazy, including failures. */
export function createBrowserRouteModules(source: RouteObject[]) {
  const loaders = new Map<RouteObject, () => Promise<unknown>>();
  function declarativeRoute(route: RouteObject): RouteObject {
    const result = { ...route };
    delete result.lazy;
    delete result.HydrateFallback;
    if (route.children) result.children = route.children.map(declarativeRoute);
    if (route.lazy) {
      const load = route.lazy;
      if (typeof load !== "function") throw new Error("Front route module must be a component loader");
      let promise: ReturnType<typeof load> | undefined;
      const loadOnce = () => promise ??= load();
      loaders.set(result, loadOnce);
      result.Component = lazy(async () => {
        const module = await loadOnce();
        if (!module.Component) throw new Error("Front route module must export a Component");
        return { default: module.Component };
      });
    }
    return result;
  }
  const browserRoutes = source.map(declarativeRoute);
  return {
    routes: browserRoutes,
    startMatchedModules(location: Parameters<typeof matchRoutes>[1]) {
      for (const match of matchRoutes(browserRoutes, location) ?? []) {
        // React.lazy consumes the same rejection; prevent an eager unhandled-rejection event.
        void loaders.get(match.route)?.().catch(() => {});
      }
    },
  };
}

const browserModules = createBrowserRouteModules(routes);

export function BrowserRoutes() {
  const location = useLocation();
  browserModules.startMatchedModules(location);
  const route = useRoutes(browserModules.routes);
  return <Suspense fallback={<DefaultSkeleton />}>{route}</Suspense>;
}
