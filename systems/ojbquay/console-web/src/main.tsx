import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {App as AntApp, ConfigProvider, Spin, theme} from "antd";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router";
import {AuthProvider, useAuth} from "./auth";
import {ConsoleLayout} from "./Layout";
import {AdminPage} from "./pages/AdminPage";
import {DashboardPage} from "./pages/DashboardPage";
import {DelayPage} from "./pages/DelayPage";
import {GroupsPage} from "./pages/GroupsPage";
import {LoginPage} from "./pages/LoginPage";
import {SubscriptionsPage} from "./pages/SubscriptionsPage";
import {TopicsPage} from "./pages/TopicsPage";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: 1,
    },
  },
});

function Guard() {
  const {actor, loading} = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="center-stage">
        <Spin size="large" />
      </div>
    );
  }
  if (!actor) {
    return <Navigate to="/login" replace state={{from: location}} />;
  }
  return <ConsoleLayout />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Guard />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="topics/*" element={<TopicsPage />} />
        <Route path="groups/*" element={<GroupsPage />} />
        <Route path="subscriptions/*" element={<SubscriptionsPage />} />
        <Route path="delay" element={<DelayPage />} />
        <Route path="admin/:section" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export function RootApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        theme={{
          algorithm: theme.defaultAlgorithm,
          token: {
            colorPrimary: "#087f8c",
            colorInfo: "#087f8c",
            colorSuccess: "#2f9e72",
            colorWarning: "#e67e22",
            colorError: "#d95763",
            borderRadius: 10,
            fontFamily:
              "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
          },
        }}
      >
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <RootApp />
    </React.StrictMode>,
  );
}
