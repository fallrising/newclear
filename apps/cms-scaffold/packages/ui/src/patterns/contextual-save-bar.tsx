import { useEffect } from "react";
import { useBlocker } from "react-router";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { Button } from "../components/ui/button";
import { uiCopy } from "../copy";

export interface ContextualSaveBarProps {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Label of the save button; defaults to "儲存". */
  saveLabel?: string;
}

/**
 * 01 §6.2: while dirty, a bar over the top bar offers 捨棄 / 儲存; leaving by the router asks for confirmation and
 * closing or reloading the tab triggers the browser's own prompt (beforeunload). Fixes C-06. Its buttons are
 * type="button", so a bar rendered inside a <form> saves once, through onSave.
 */
export function ContextualSaveBar({ dirty, saving, onSave, onDiscard, saveLabel }: ContextualSaveBarProps) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <>
      {dirty ? (
        <div role="region" aria-label={uiCopy["ui.save.title"]} className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 bg-primary px-4 text-primary-foreground lg:px-6" data-testid="save-bar">
          <span className="mr-auto text-card-title">{uiCopy["ui.save.title"]}</span>
          <Button type="button" variant="outline" className="bg-transparent text-primary-foreground hover:bg-white/10 hover:text-primary-foreground" onClick={onDiscard} disabled={saving} data-testid="save-bar-discard">
            {uiCopy["ui.save.discard"]}
          </Button>
          <Button type="button" variant="secondary" onClick={onSave} disabled={saving} data-testid="save-bar-save">
            {saving ? uiCopy["ui.save.saving"] : (saveLabel ?? uiCopy["ui.save.save"])}
          </Button>
        </div>
      ) : null}
      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent data-testid="leave-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{uiCopy["ui.leave.title"]}</AlertDialogTitle>
            <AlertDialogDescription>{uiCopy["ui.leave.body"]}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()} data-testid="leave-stay">
              {uiCopy["ui.leave.stay"]}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()} data-testid="leave-confirm">
              {uiCopy["ui.leave.leave"]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
