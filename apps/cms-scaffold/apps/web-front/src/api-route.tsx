import { useContext, useState } from "react";
import { QueryClientContext, QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "@cms/auth";
import { Outlet } from "react-router";
import { QueryLifetimeContext } from "./query-lifetime";

/** Only routes using API data load the query runtime; the selector needs none. */
export function ApiRoute() {
  const lifetime = useContext(QueryLifetimeContext);
  const suppliedClient = useContext(QueryClientContext);
  const [client] = useState(() => {
    if (lifetime) return lifetime.client ??= createAppQueryClient();
    // Isolated route renderers may provide their own client; never replace its options or cache.
    return suppliedClient ?? createAppQueryClient();
  });
  return <QueryClientProvider client={client}><Outlet /></QueryClientProvider>;
}
