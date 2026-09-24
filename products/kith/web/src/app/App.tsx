import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import { LocaleProvider } from "../copy";
import { LoginPage } from "../features/auth/LoginPage";
import { HomeEmpty } from "../features/rooms";
import { AppLayout } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundPage } from "./NotFoundPage";
import { createQueryClient } from "./queryClient";
import { RequireAuth } from "./RequireAuth";
import { RoomPage } from "./RoomPage";

const queryClient = createQueryClient();

function Layout(props: { mobile: "list" | "content"; children: ReactNode }): ReactElement | null {
  const me = useMe().data;
  if (!me) return null;
  return (
    <AppLayout me={me} mobile={props.mobile}>
      {props.children}
    </AppLayout>
  );
}

function HomeEmptyRoute(): ReactElement | null {
  const me = useMe().data;
  if (!me) return null;
  return <HomeEmpty me={me} />;
}

export function App(): ReactElement {
  return (
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<RequireAuth><Layout mobile="list"><HomeEmptyRoute /></Layout></RequireAuth>} />
              <Route path="/r/:slug" element={<RequireAuth><Layout mobile="content"><RoomPage /></Layout></RequireAuth>} />
              <Route path="*" element={<RequireAuth><Layout mobile="content"><NotFoundPage /></Layout></RequireAuth>} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  );
}
