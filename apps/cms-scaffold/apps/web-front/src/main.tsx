import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@cms/ui/styles.css";

async function start() {
  // `vite --mode mock` only. In a production build MODE is "production", so this branch and the
  // @cms/mocks import are removed (checked by `npm run test:bundle`).
  if (import.meta.env.MODE === "mock") {
    const { startMockWorker } = await import("@cms/mocks/browser");
    await startMockWorker("front");
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
