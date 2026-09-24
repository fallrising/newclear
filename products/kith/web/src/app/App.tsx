import { useContext, type ReactElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import { useRooms } from "../api/rooms";
import { LocaleProvider } from "../copy";
import { ConsoleForbidden, ConsoleLayout, PeoplePage, RoomsAdminPage } from "../features/console";
import { LoginPage } from "../features/auth/LoginPage";
import { HomeEmpty } from "../features/rooms";
import { SettingsPage } from "../features/settings";
import { AppLayout, CreateRoomContext } from "./AppLayout";
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

function ConsoleGuard(props: { children: ReactNode }): ReactElement {
  const me = useMe().data;
  if (!me) return <></>;
  if (me.is_operator !== 1) return <ConsoleForbidden />;
  return <>{props.children}</>;
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
              <Route path="/settings" element={<RequireAuth><Layout mobile="content"><SettingsRoute /></Layout></RequireAuth>} />
              <Route path="/console" element={<RequireAuth><Navigate to="/console/people" replace /></RequireAuth>} />
              <Route
                path="/console/people"
                element={
                  <RequireAuth>
                    <Layout mobile="content">
                      <ConsoleGuard>
                        <ConsoleLayout active="people">
                          <PeoplePage />
                        </ConsoleLayout>
                      </ConsoleGuard>
                    </Layout>
                  </RequireAuth>
                }
              />
              <Route
                path="/console/rooms"
                element={
                  <RequireAuth>
                    <Layout mobile="content">
                      <ConsoleGuard>
                        <ConsoleLayout active="rooms">
                          <RoomsAdminPage />
                        </ConsoleLayout>
                      </ConsoleGuard>
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
