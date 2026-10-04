const DATETIME = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" });

/** Local date and time of an ISO instant; empty for a missing or invalid value. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value || Number.isNaN(Date.parse(value))) return "";
  return DATETIME.format(new Date(value));
}

const UNITS = ["B", "KB", "MB", "GB"] as const;

/** Bytes in 1024 steps with at most one decimal: 32832 → "32.1 KB", 1073741824 → "1 GB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : Number(value.toFixed(1))} ${UNITS[unit]}`;
}

/**
 * "YYYY-MM-DD" of a local calendar day → the ISO instant of that day's local midnight, moved by `offsetDays`
 * (the audit filter sends `to` as the next day's midnight, because the API's `to` is exclusive). Null when the
 * value is not a real date ("2026-02-30").
 */
export function localDayStart(day: string, offsetDays = 0): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(year, month - 1, date);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== date) return null;
  return new Date(year, month - 1, date + offsetDays).toISOString();
}
