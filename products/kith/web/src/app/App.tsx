import { lazy, Suspense, useContext, type ReactElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import { useRooms } from "../api/rooms";
import { LocaleProvider } from "../copy";
import { LoginPage } from "../features/auth/LoginPage";
import { HomeEmpty } from "../features/rooms";
import { SettingsPage } from "../features/settings";
import { AppLayout, CreateRoomContext } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundPage } from "./NotFoundPage";
import { createQueryClient } from "./queryClient";
import { RequireAuth } from "./RequireAuth";
import { RoomPage } from "./RoomPage";
import { RouteLoading } from "./RouteLoading";

const queryClient = createQueryClient();
const ConsoleRoutes = lazy(() => import("./ConsoleRoutes").then((m) => ({ default: m.ConsoleRoutes })));

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
  const rooms = useRooms();
  const onCreateRoom = useContext(CreateRoomContext);
  if (!me || rooms.isPending || !rooms.data) return null;
  return <HomeEmpty me={me} roomCount={rooms.data.length} onCreateRoom={onCreateRoom} />;
}

function SettingsRoute(): ReactElement | null {
  const me = useMe().data;
  if (!me) return null;
  return <SettingsPage me={me} />;
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
              <Route path="/r/:slug" element={<RequireAuth><Layout mobile="content"><RoomPage /></Layout></RequireAuth>}>
                <Route path="t/:threadId" element={null} />
              </Route>
              <Route path="/settings" element={<RequireAuth><Layout mobile="content"><SettingsRoute /></Layout></RequireAuth>} />
              <Route
                path="/console/*"
                element={
                  <RequireAuth>
                    <Layout mobile="content">
                      <Suspense fallback={<RouteLoading />}>
                        <ConsoleRoutes />
                      </Suspense>
                    </Layout>
                  </RequireAuth>
                }
              />
              <Route path="*" element={<RequireAuth><Layout mobile="content"><NotFoundPage /></Layout></RequireAuth>} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  );
}
