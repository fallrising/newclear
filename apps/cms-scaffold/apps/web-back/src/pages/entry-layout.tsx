import { Outlet } from "react-router";
import { FieldsProvider } from "@cms/fields";
import { api } from "../api";

const fieldsServices = { work: api.work, url: (path: string) => api.url(path) };

export function EntryLayout() {
  return <FieldsProvider value={fieldsServices}><Outlet /></FieldsProvider>;
}
