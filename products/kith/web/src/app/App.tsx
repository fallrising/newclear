import type { ReactElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import { LocaleProvider } from "../copy";
import { LoginPage } from "../features/auth/LoginPage";
import { AppShell } from "./AppShell";
import { ErrorBoundary } from "./ErrorBoundary";
import { HomePlaceholder } from "./HomePlaceholder";
import { NotFoundPage } from "./NotFoundPage";
import { createQueryClient } from "./queryClient";
import { RequireAuth } from "./RequireAuth";

const queryClient = createQueryClient();

function HomePlaceholderRoute(): ReactElement | null {
  const me = useMe().data;
  if (!me) return null;
  return (
    <AppShell me={me}>
      <HomePlaceholder me={me} />
    </AppShell>
  );
}

function NotFoundRoute(): ReactElement | null {
  const me = useMe().data;
  if (!me) return null;
  return (
    <AppShell me={me}>
      <NotFoundPage />
    </AppShell>
  );
}

export function App(): ReactElement {
  return (
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<RequireAuth><HomePlaceholderRoute /></RequireAuth>} />
              <Route path="*" element={<RequireAuth><NotFoundRoute /></RequireAuth>} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  );
}
