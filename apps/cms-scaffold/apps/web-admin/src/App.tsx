import { lazy, Suspense, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { api } from "./api";
import { routes } from "./routes";

const DeferredToaster = lazy(() => import("./deferred-toaster"));

export default function App() {
  const [queryClient] = useState(createAppQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider auth={api.auth}>
        <RouterProvider router={router} />
        <Suspense fallback={null}><DeferredToaster /></Suspense>
      </SessionProvider>
    </QueryClientProvider>
  );
}
