import type { WorkField } from "@cms/api";
import { fieldsCopy } from "./copy";
import { enumLabel } from "./labels";

const DATETIME = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" });
const DATE = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });

/** Local date and time for an ISO instant (01 §6.4: shown in the user's zone). Empty for missing or invalid values. */
export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "";
  return DATETIME.format(new Date(value));
}

export function formatDate(date: Date): string {
  return DATE.format(date);
}

/** Markdown as plain text, cut to 80 characters (01 §6.4 list display). */
export function plainExcerpt(markdown: string): string {
  const text = markdown.replace(/[#*_`>[\]()~-]/g, "").replace(/\s+/g, " ").trim();
  const chars = [...text];
  return chars.length > 80 ? `${chars.slice(0, 80).join("")}…` : text;
}

/** Text for a list cell of a non-ref, non-media field. */
export function formatValue(field: WorkField, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (field.type) {
    case "string":
      return String(value);
    case "markdown":
      return plainExcerpt(String(value));
    case "int":
      return typeof value === "number" ? String(value) : "";
    case "boolean":
      return value === true ? fieldsCopy["fields.boolean.yes"] : "";
    case "enum":
      return typeof value === "string" ? enumLabel(field, value) : "";
    case "datetime":
      return formatDateTime(value);
    case "principal-ref":
      return fieldsCopy["fields.principal.linked"];
    default:
      return "";
  }
}

const DAY = new Intl.DateTimeFormat("zh-TW", { dateStyle: "full" });
const TIME = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** A local calendar day with its weekday, for example "2026年9月20日 星期日". */
export function formatDay(date: Date): string {
  return DAY.format(date);
}

/** Local 24-hour time of an ISO instant, for example "17:00". Empty for missing or invalid values. */
export function formatTime(value: unknown): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return "";
  return TIME.format(new Date(value));
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** Bytes in 1024 steps with at most one decimal: 1240 → "1.2 KB", 15728640 → "15 MB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : Number(value.toFixed(1))} ${UNITS[unit]}`;
}
