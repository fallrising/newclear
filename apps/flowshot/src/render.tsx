import { loadBuildInfoAtLaunch } from "./launch-build-info";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Flowshot root element was not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App loadBuildInfo={loadBuildInfoAtLaunch} />
  </StrictMode>,
);
