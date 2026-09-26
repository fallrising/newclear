import type { ReactElement, ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useMe } from "../api/auth";
import {
  AgentDetailPage,
  AgentsPage,
  ConsoleForbidden,
  ConsoleLayout,
  CreateAgentWizard,
  PeoplePage,
  ProviderForm,
  ProvidersPage,
  RoomsAdminPage,
} from "../features/console";
import { InviteDialog } from "../features/invite";
import { NotFoundPage } from "./NotFoundPage";

// ConsoleGuard：從 App.tsx 原封不動搬來（W2 §5.6.5）。非 operator 在 children 渲染前就看到 ConsoleForbidden。

type Active = "agents" | "providers" | "people" | "rooms";

function ConsoleGuard(props: { children: ReactNode }): ReactElement {
  const me = useMe().data;
  if (!me) return <></>;
  if (me.is_operator !== 1) return <ConsoleForbidden />;
  return <>{props.children}</>;
}

function Page(props: { active: Active; children: ReactNode }) {
  return (
    <ConsoleGuard>
      <ConsoleLayout active={props.active}>{props.children}</ConsoleLayout>
    </ConsoleGuard>
  );
}

/** Everything under /console. Loaded lazily from App.tsx so none of it is in the first-load bundle (05 §7). */
export function ConsoleRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="/console/agents" replace />} />
      <Route path="agents" element={<Page active="agents"><AgentsPage /></Page>} />
      <Route path="agents/new" element={<Page active="agents"><CreateAgentWizard /></Page>} />
      <Route path="agents/:id" element={<Page active="agents"><AgentDetailPage /></Page>} />
      <Route path="providers" element={<Page active="providers"><ProvidersPage /></Page>} />
      <Route path="providers/new" element={<Page active="providers"><ProviderForm mode="new" /></Page>} />
      <Route path="providers/:id" element={<Page active="providers"><ProviderForm mode="edit" /></Page>} />
      <Route path="people" element={<Page active="people"><PeoplePage /></Page>} />
      <Route
        path="rooms"
        element={<Page active="rooms"><RoomsAdminPage renderInvite={(p) => <InviteDialog {...p} />} /></Page>}
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
