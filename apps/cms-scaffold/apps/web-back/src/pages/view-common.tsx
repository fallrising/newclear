import { useEffect, useRef, type MouseEvent } from "react";
import type { Announcements, ScreenReaderInstructions } from "@dnd-kit/core";
import { useSearchParams } from "react-router";
import type { WorkEntry } from "@cms/api";
import { fill, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@cms/ui";
import { copy } from "../copy";

// Shared by the three custom views (01 §7.2 B-S5～B-S7).

/** Each view reads at most one API page of 100 entries (G-02 maximum); more is noted on screen. */
export const VIEW_PAGE_SIZE = 100;

/**
 * One URL query parameter as state (01 §4.4, fixes C-10): the value follows the URL (back/forward, pasted links) and
 * setting it pushes a history entry. `null` or "" removes the parameter.
 */
export function useQueryParam(name: string): [string, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const set = (value: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    });
  return [params.get(name) ?? "", set];
}

/** The entry named by `id`, else the first one (lists are sorted by the API; the first is the default). */
export function pickEntry(entries: WorkEntry[] | undefined, id: string): WorkEntry | undefined {
  return entries?.find((e) => e.id === id) ?? entries?.[0];
}

export function titleOf(entry: WorkEntry): string {
  return entry.title || copy["index.untitled"];
}

/** Album and project picker: a labelled Select of entry titles. */
export function EntrySelect({ id, label, entries, value, onChange }: { id: string; label: string; entries: WorkEntry[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="flex min-w-56 flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full sm:w-72" data-testid={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {entries.map((entry) => (
            <SelectItem key={entry.id} value={entry.id}>
              {titleOf(entry)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}


/** zh-Hant texts for dnd-kit's live region (it would announce English defaults otherwise). */
export function dndTexts(name: (id: string | number) => string, target: (id: string | number) => string): { announcements: Announcements; screenReaderInstructions: ScreenReaderInstructions } {
  return {
    screenReaderInstructions: { draggable: copy["dnd.instructions"] },
    announcements: {
      onDragStart: ({ active }) => fill(copy["dnd.start"], { title: name(active.id) }),
      onDragOver: ({ active, over }) => (over ? fill(copy["dnd.over"], { title: name(active.id), target: target(over.id) }) : undefined),
      onDragEnd: ({ active }) => fill(copy["dnd.end"], { title: name(active.id) }),
      onDragCancel: ({ active }) => fill(copy["dnd.cancel"], { title: name(active.id) }),
    },
  };
}

/**
 * The pointer is released over the dragged card itself, so the browser turns the drop into a click on whatever is
 * under it (a title link, a menu button). Spread the result on the draggable element: a click right after a drag is
 * swallowed.
 */
export function useDropClickGuard(isDragging: boolean) {
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);
  return {
    onPointerDownCapture: () => {
      dragged.current = false;
    },
    onClickCapture: (event: MouseEvent) => {
      if (!dragged.current) return;
      dragged.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
