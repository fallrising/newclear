import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {App as AntApp, ConfigProvider} from "antd";
import {render} from "@testing-library/react";
import type {ReactElement} from "react";
import {MemoryRouter} from "react-router";
import {AuthProvider} from "../auth";
import {AppRoutes} from "../main";

export function renderApp(path = "/dashboard") {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider>
        <AntApp>
          <MemoryRouter initialEntries={[path]}>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </MemoryRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>,
  );
}

export function renderWithData(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfigProvider><AntApp>{ui}</AntApp></ConfigProvider>
    </QueryClientProvider>,
  );
}
