import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useRoomNav } from "../store/roomNav";

function neighbor(order: readonly string[], unread: readonly string[], current: string | null, delta: 1 | -1, unreadOnly: boolean): string | null {
  if (order.length === 0) return null;
  const here = current !== null && order.includes(current) ? current : null;
  if (!unreadOnly && here === null) return order[0] ?? null;
  const unreadSet = new Set(unread);
  const origin = here === null ? (delta > 0 ? -1 : 0) : order.indexOf(here);
  for (let step = 1; step <= order.length; step++) {
    const wrapped = (((origin + delta * step) % order.length) + order.length) % order.length;
    const slug = order[wrapped];
    if (!slug) continue;
    if (unreadOnly && !unreadSet.has(slug)) continue;
    if (slug === here) return null;
    return slug;
  }
  return null;
}

export function useShortcuts(): {
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
} {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.isComposing || e.keyCode === 229) return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (meta && !e.altKey && e.key === "/") {
        e.preventDefault();
        setHelpOpen(true);
        return;
      }
      const dialogOpen = document.querySelector('[role="dialog"][data-state="open"]') !== null;
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (dialogOpen) return;
        e.preventDefault();
        const { order, unread } = useRoomNav.getState();
        const slug = location.pathname.startsWith("/r/") ? decodeURIComponent(location.pathname.slice(3).split("/")[0] ?? "") : null;
        const next = neighbor(order, unread, slug, e.key === "ArrowDown" ? 1 : -1, e.shiftKey);
        if (next) void navigate("/r/" + next);
        return;
      }
      if (e.key !== "Escape") return;
      if (dialogOpen) return;
      if (document.querySelector('[role="menu"][data-state="open"], [data-testid="mention-listbox"]')) return;
      if (!location.pathname.startsWith("/r/")) return;
      window.dispatchEvent(new Event("kith:scroll-latest"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [location.pathname, navigate]);
  return { switcherOpen, setSwitcherOpen, helpOpen, setHelpOpen };
}
