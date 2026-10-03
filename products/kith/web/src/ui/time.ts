import { translate, type Locale } from "../copy";

/** "YYYY-MM-DD" in the given time zone. */
export function dateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

export function formatClock(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

export function dateLabel(
  key: string,
  locale: Locale,
  now: Date,
  timeZone: string,
): { kind: "today" | "yesterday" | "other"; text: string } {
  const today = dateKey(now.toISOString(), timeZone);
  const yesterday = dateKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  if (key === today) return { kind: "today", text: key };
  if (key === yesterday) return { kind: "yesterday", text: key };
  const text = new Intl.DateTimeFormat(locale, { timeZone, month: "long", day: "numeric", weekday: "short" }).format(
    new Date(key + "T12:00:00Z"),
  );
  return { kind: "other", text };
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatListTime(iso: string, locale: Locale, now: Date, timeZone: string): string {
  const diff = now.getTime() - Date.parse(iso);
  if (diff < 60_000) return translate(locale, "rooms.list.justNow");
  if (diff < 3_600_000) return translate(locale, "rooms.list.minutesAgo", { n: Math.floor(diff / 60_000) });
  if (dateKey(iso, timeZone) === dateKey(now.toISOString(), timeZone)) return formatClock(iso, locale);
  const yesterday = dateKey(new Date(now.getTime() - 86_400_000).toISOString(), timeZone);
  if (dateKey(iso, timeZone) === yesterday) return translate(locale, "timeline.yesterday");
  return new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}
