import { createContext, useContext, type ReactNode } from "react";
import type { WorkApi } from "@cms/api";

export interface FieldsServices {
  work: WorkApi;
  /** Absolute URL for a root-relative API path (media variants). */
  url: (path: string) => string;
}

const FieldsContext = createContext<FieldsServices | null>(null);

/** Gives read-only ref and media values access to the API client. web-back provides it once in App. */
export function FieldsProvider({ value, children }: { value: FieldsServices; children: ReactNode }) {
  return <FieldsContext.Provider value={value}>{children}</FieldsContext.Provider>;
}

export function useFieldsServices(): FieldsServices {
  const value = useContext(FieldsContext);
  if (!value) throw new Error("FieldsProvider is missing");
  return value;
}
