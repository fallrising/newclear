import { createContext } from "react";
import type { QueryClient } from "@tanstack/react-query";

/** Owned by App; the lazy data-route provider fills this once and reuses it after remounts. */
export interface QueryLifetime { client?: QueryClient }
export const QueryLifetimeContext = createContext<QueryLifetime | null>(null);
