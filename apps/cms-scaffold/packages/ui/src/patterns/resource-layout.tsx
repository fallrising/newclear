import type { ReactNode } from "react";

/** 01 §6.2: main column 2fr + aside 1fr; below 1024px one column with the aside after the main column. */
export function ResourceLayout({ main, aside }: { main: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]" data-testid="resource-layout">
      <div className="flex min-w-0 flex-col gap-4">{main}</div>
      <aside className="flex min-w-0 flex-col gap-4">{aside}</aside>
    </div>
  );
}
