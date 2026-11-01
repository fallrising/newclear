import { fireEvent, screen } from "@testing-library/react";

/** Opens PageHeader's 更多動作 menu (Radix opens it on Enter in jsdom) and returns nothing; items are then in the document. */
export async function openMoreActions() {
  fireEvent.keyDown(await screen.findByTestId("page-more-actions"), { key: "Enter" });
}

/** Every full UUID in visible text (V2-AC-05: none may appear). */
export function visibleUuids(root: HTMLElement = document.body): string[] {
  return root.textContent?.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
}

/** V2-AC-15: engineering words that must never be visible. */
export const FORBIDDEN_WORDS = ["PATCH", "sortOrder", "origin", "(string)"] as const;
