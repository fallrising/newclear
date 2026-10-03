import type { ReactElement } from "react";
import { useT, type CopyKey } from "../copy";
import { Dialog } from "../ui/Dialog";

const ROWS: { keys: (mod: string) => string; label: CopyKey }[] = [
  { keys: (mod) => mod + " K", label: "shortcuts.switcher" },
  { keys: (mod) => mod + " /", label: "shortcuts.help" },
  { keys: () => "Alt ↑ ↓", label: "shortcuts.nextRoom" },
  { keys: () => "Alt Shift ↑ ↓", label: "shortcuts.nextUnread" },
  { keys: () => "Esc", label: "shortcuts.escape" },
];

export function ShortcutsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }): ReactElement {
  const t = useT();
  const mac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const mod = mac ? "⌘" : "Ctrl";
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} title={t("shortcuts.title")} data-testid="shortcuts-dialog">
      <table className="w-full text-sm">
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.label}>
              <td className="py-1 pr-3">
                <kbd className="rounded-sm border border-border px-1 font-mono text-xs">{row.keys(mod)}</kbd>
              </td>
              <td className="py-1 text-ink">{t(row.label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
