import { createClient } from "@cms/api";

export const api = createClient({
  base: import.meta.env.VITE_API_BASE || "http://localhost:8080",
  surface: "back",
});
