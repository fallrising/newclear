import { useState } from "react";
import { BrowserRouter } from "react-router";
import { QueryLifetimeContext, type QueryLifetime } from "./query-lifetime";
import { BrowserRoutes } from "./browser-routes";

export default function App() {
  const [lifetime] = useState<QueryLifetime>(() => ({}));
  return (
    <QueryLifetimeContext.Provider value={lifetime}>
      <BrowserRouter><BrowserRoutes /></BrowserRouter>
    </QueryLifetimeContext.Provider>
  );
}
