import type { ReactElement } from "react";
import { useT } from "../copy";

export function Wordmark(props: { size: "md" | "lg" }): ReactElement {
  const t = useT();
  const size = props.size === "md" ? "text-lg" : "text-2xl";
  return <span className={"font-semibold text-accent " + size}>{t("app.name")}</span>;
}
