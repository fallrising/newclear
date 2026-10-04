import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { createAppQueryClient, SessionProvider } from "@cms/auth";
import { FieldsProvider } from "@cms/fields";
import { Toaster } from "@cms/ui";
import { api } from "./api";
import { routes } from "./routes";

const fieldsServices = { work: api.work, url: (path: string) => api.url(path) };

export default function App() {
  const [queryClient] = useState(createAppQueryClient);
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider auth={api.auth}>
        <FieldsProvider value={fieldsServices}>
          <RouterProvider router={router} />
          <Toaster />
        </FieldsProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
