import { lazy, Suspense, useContext, type ReactElement, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import { useRooms } from "../api/rooms";
import { LocaleProvider } from "../copy";
import { ConsoleForbidden, ConsoleLayout, PeoplePage, RoomsAdminPage } from "../features/console";
import { LoginPage } from "../features/auth/LoginPage";
import { InviteDialog } from "../features/invite";
import { HomeEmpty } from "../features/rooms";
import { SettingsPage } from "../features/settings";
import { AppLayout, CreateRoomContext } from "./AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotFoundPage } from "./NotFoundPage";
import { createQueryClient } from "./queryClient";
import { RequireAuth } from "./RequireAuth";
import { RoomPage } from "./RoomPage";

const queryClient = createQueryClient();
const AgentsPage = lazy(() => import("../features/console/agents/AgentsPage").then((m) => ({ default: m.AgentsPage })));
const CreateAgentWizard = lazy(() => import("../features/console/agents/CreateAgentWizard").then((m) => ({ default: m.CreateAgentWizard })));
const AgentDetailPage = lazy(() => import("../features/console/agents/AgentDetailPage").then((m) => ({ default: m.AgentDetailPage })));
const ProvidersPage = lazy(() => import("../features/console/providers/ProvidersPage").then((m) => ({ default: m.ProvidersPage })));
const ProviderForm = lazy(() => import("../features/console/providers/ProviderForm").then((m) => ({ default: m.ProviderForm })));

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

function ConsoleScreen(props: { active: "agents" | "providers" | "people" | "rooms"; children: ReactNode }): ReactElement {
  return (
    <RequireAuth>
      <Layout mobile="content">
        <ConsoleGuard>
          <ConsoleLayout active={props.active}>
            <Suspense fallback={null}>{props.children}</Suspense>
          </ConsoleLayout>
        </ConsoleGuard>
      </Layout>
    </RequireAuth>
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
              <Route path="/" element={<RequireAuth><Layout mobile="list"><HomeEmptyRoute /></Layout></RequireAuth>} />
              <Route path="/r/:slug" element={<RequireAuth><Layout mobile="content"><RoomPage /></Layout></RequireAuth>}>
                <Route path="t/:threadId" element={null} />
              </Route>
              <Route path="/settings" element={<RequireAuth><Layout mobile="content"><SettingsRoute /></Layout></RequireAuth>} />
              <Route path="/console" element={<RequireAuth><Navigate to="/console/agents" replace /></RequireAuth>} />
              <Route path="/console/agents" element={<ConsoleScreen active="agents"><AgentsPage /></ConsoleScreen>} />
              <Route path="/console/agents/new" element={<ConsoleScreen active="agents"><CreateAgentWizard /></ConsoleScreen>} />
              <Route path="/console/agents/:id" element={<ConsoleScreen active="agents"><AgentDetailPage /></ConsoleScreen>} />
              <Route path="/console/providers" element={<ConsoleScreen active="providers"><ProvidersPage /></ConsoleScreen>} />
              <Route path="/console/providers/new" element={<ConsoleScreen active="providers"><ProviderForm mode="new" /></ConsoleScreen>} />
              <Route path="/console/providers/:id" element={<ConsoleScreen active="providers"><ProviderForm mode="edit" /></ConsoleScreen>} />
              <Route path="/console/people" element={<ConsoleScreen active="people"><PeoplePage /></ConsoleScreen>} />
              <Route path="/console/rooms" element={<ConsoleScreen active="rooms"><RoomsAdminPage renderInvite={(p) => <InviteDialog {...p} />} /></ConsoleScreen>} />
              <Route path="*" element={<RequireAuth><Layout mobile="content"><NotFoundPage /></Layout></RequireAuth>} />
            </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  );
}
